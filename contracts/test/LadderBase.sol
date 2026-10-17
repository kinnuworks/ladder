// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Errand} from "../src/Errand.sol";
import {ErrandFactory} from "../src/ErrandFactory.sol";

interface IUSDC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
}

/// @dev Shared helpers: a three-rung plan (AI call, human call, certified mail) and signing.
abstract contract LadderBase is Test {
    ErrandFactory factory;
    IERC20 token;

    address owner = makeAddr("owner");
    uint256 sessionKey = 0xA11CE;
    address sessionSigner;

    // In production each rung pays a one-time step key, which then pays the service. The contract
    // treats every rung payee the same way, so these tests use fixed addresses as stand-in payees.
    address constant PHONE = address(0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801);
    address constant HUMAN = address(0x4603366F72023572b139D19e354e9FA3A50c634B);
    address constant MAIL = address(0x3Ea31dE08708a6eb65f345719E6B1CdB72df0406);

    struct Rung {
        bytes32 nonce;
        address to;
        uint256 max;
        bytes32 salt;
    }

    Rung[3] rungs;
    bytes32 root;
    uint64 expiry;

    function _setUpPlan() internal {
        sessionSigner = vm.addr(sessionKey);
        rungs[0] = Rung(keccak256("rung-0"), PHONE, 540_000, keccak256("salt-0"));
        rungs[1] = Rung(keccak256("rung-1"), HUMAN, 15_000_000, keccak256("salt-1"));
        rungs[2] = Rung(keccak256("rung-2"), MAIL, 14_400_000, keccak256("salt-2"));
        expiry = uint64(block.timestamp + 7 days);
        root = _root();
    }

    function _leaf(uint256 i) internal view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(rungs[i].nonce, rungs[i].to, rungs[i].max, rungs[i].salt))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// Tree for three leaves, matching OpenZeppelin's sorted-pair verification:
    /// root = H(H(l0, l1), l2)
    function _root() internal view returns (bytes32) {
        return _hashPair(_hashPair(_leaf(0), _leaf(1)), _leaf(2));
    }

    function _proof(uint256 i) internal view returns (bytes32[] memory p) {
        if (i == 2) {
            p = new bytes32[](1);
            p[0] = _hashPair(_leaf(0), _leaf(1));
        } else {
            p = new bytes32[](2);
            p[0] = _leaf(i == 0 ? 1 : 0);
            p[1] = _leaf(2);
        }
    }

    function _authSig(Errand errand, uint256 i, address to, uint256 value, uint256 validBefore, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = errand.authorizationDigest(to, value, 0, validBefore, rungs[i].nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        Errand.RungAuth memory a = Errand.RungAuth({
            to: to,
            value: value,
            validAfter: 0,
            validBefore: validBefore,
            nonce: rungs[i].nonce,
            max: rungs[i].max,
            salt: rungs[i].salt,
            proof: _proof(i),
            sessionSig: abi.encodePacked(r, s, v)
        });
        return abi.encode(a);
    }

    function _pay(Errand errand, uint256 i, uint256 value) internal {
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, i, rungs[i].to, value, validBefore, sessionKey);
        IUSDC3009(address(token))
            .transferWithAuthorization(address(errand), rungs[i].to, value, 0, validBefore, rungs[i].nonce, sig);
    }

    function _refundSig(Errand errand, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(errand.REFUND_TYPEHASH(), address(errand), block.chainid));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
