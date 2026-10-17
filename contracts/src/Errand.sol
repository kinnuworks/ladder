// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IEIP3009Domain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @title Errand
/// @notice A single-errand USDC account. The owner funds it once; afterwards it can pay
///         only the rungs committed in `rungsRoot`, each at most once and at most its cap,
///         and only before `expiry`. Everything else it holds can only go back to the owner.
/// @dev Payments leave through USDC's EIP-3009 `transferWithAuthorization`, which checks
///      contract payers with ERC-1271. This contract never calls USDC to pay anyone; it only
///      answers `isValidSignature` for authorizations that match a committed rung.
contract Errand is IERC1271 {
    using SafeERC20 for IERC20;

    /// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    /// Domain tag for the gasless refund signature.
    bytes32 public constant REFUND_TYPEHASH = keccak256("LadderRefund(address errand,uint256 chainId)");

    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;

    IERC20 public immutable usdc;
    bytes32 public immutable usdcDomainSeparator;
    address public immutable factory;

    address public owner;
    address public sessionSigner;
    uint64 public expiry;
    bool public closed;
    bytes32 public rungsRoot;

    event Refunded(address indexed to, uint256 amount, address indexed caller);

    error AlreadyInitialized();
    error NotFactory();
    error NotAllowed();
    error BadRefundSignature();

    /// A rung payment as the session signer authorizes it. `max` and `salt` are the parts of
    /// the committed leaf that are not visible in the USDC authorization itself.
    struct RungAuth {
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint256 max;
        bytes32 salt;
        bytes32[] proof;
        bytes sessionSig;
    }

    constructor(IERC20 usdc_) {
        usdc = usdc_;
        usdcDomainSeparator = IEIP3009Domain(address(usdc_)).DOMAIN_SEPARATOR();
        factory = msg.sender;
        // Lock the implementation itself.
        owner = address(0xdead);
    }

    function initialize(address owner_, address sessionSigner_, uint64 expiry_, bytes32 rungsRoot_) external {
        if (msg.sender != factory) revert NotFactory();
        if (owner != address(0)) revert AlreadyInitialized();
        owner = owner_;
        sessionSigner = sessionSigner_;
        expiry = expiry_;
        rungsRoot = rungsRoot_;
    }

    /// @notice The leaf committed for a rung. Double-hashed so a leaf can never be read as an inner node.
    function rungLeaf(bytes32 nonce, address to, uint256 max, bytes32 salt) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(nonce, to, max, salt))));
    }

    /// @notice The EIP-712 digest USDC computes for a transfer from this errand.
    function authorizationDigest(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, address(this), to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", usdcDomainSeparator, structHash));
    }

    /// @inheritdoc IERC1271
    /// @dev `signature` is `abi.encode(RungAuth)`. The digest is rebuilt from the authorization fields,
    ///      so a signature can only ever validate a USDC transfer to a committed payee within its cap.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (closed || block.timestamp >= expiry || signature.length < 32 * 9) return INVALID;

        RungAuth memory a = abi.decode(signature, (RungAuth));

        if (a.value > a.max) return INVALID;
        if (a.validBefore > expiry) return INVALID;
        if (authorizationDigest(a.to, a.value, a.validAfter, a.validBefore, a.nonce) != hash) return INVALID;
        if (!MerkleProof.verify(a.proof, rungsRoot, rungLeaf(a.nonce, a.to, a.max, a.salt))) return INVALID;

        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, a.sessionSig);
        if (err != ECDSA.RecoverError.NoError || recovered != sessionSigner) return INVALID;

        return MAGIC;
    }

    /// @notice Send everything back to the owner. The owner can do this at any time; anyone can after expiry.
    function refund() external {
        if (msg.sender != owner && block.timestamp < expiry) revert NotAllowed();
        _refund();
    }

    /// @notice Gasless early refund. Anyone may relay it, but the money can only go to the owner.
    function refundWithSig(bytes calldata sessionSig) external {
        bytes32 digest = keccak256(abi.encode(REFUND_TYPEHASH, address(this), block.chainid));
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sessionSig);
        if (err != ECDSA.RecoverError.NoError || recovered != sessionSigner) revert BadRefundSignature();
        _refund();
    }

    /// @notice Return any other token sent here by mistake. Owner at any time, anyone after expiry.
    function sweep(IERC20 token) external {
        if (msg.sender != owner && block.timestamp < expiry) revert NotAllowed();
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) token.safeTransfer(owner, bal);
    }

    function _refund() internal {
        closed = true;
        uint256 bal = usdc.balanceOf(address(this));
        if (bal > 0) usdc.safeTransfer(owner, bal);
        emit Refunded(owner, bal, msg.sender);
    }
}
