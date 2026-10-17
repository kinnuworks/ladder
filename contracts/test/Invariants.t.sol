// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Errand} from "../src/Errand.sol";
import {ErrandFactory} from "../src/ErrandFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {LadderBase, IUSDC3009} from "./LadderBase.sol";

/// @dev Drives the errand with honest and hostile actions. The invariants say where money may go.
contract Handler is LadderBase {
    Errand public errand;
    MockUSDC public usdc;
    uint256 public attacks;

    constructor(MockUSDC usdc_, Errand errand_, ErrandFactory factory_) {
        usdc = usdc_;
        token = IERC20(address(usdc_));
        errand = errand_;
        factory = factory_;
        _setUpPlan();
    }

    function payRung(uint256 i, uint256 value) external {
        i = bound(i, 0, 2);
        value = bound(value, 0, rungs[i].max);
        uint256 validBefore = block.timestamp + 300;
        if (validBefore > errand.expiry()) return;
        bytes memory sig = _authSig(errand, i, rungs[i].to, value, validBefore, sessionKey);
        try IUSDC3009(address(usdc))
            .transferWithAuthorization(address(errand), rungs[i].to, value, 0, validBefore, rungs[i].nonce, sig) {}
            catch {}
    }

    function attackPayee(uint256 i, address to, uint256 value) external {
        attacks++;
        i = bound(i, 0, 2);
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, i, to, value, validBefore, sessionKey);
        try IUSDC3009(address(usdc))
            .transferWithAuthorization(
                address(errand), to, value, 0, validBefore, keccak256(abi.encode(to, value, attacks)), sig
            ) {}
            catch {}
    }

    function attackKey(uint256 key, uint256 value) external {
        attacks++;
        key = bound(key, 1, type(uint128).max);
        if (key == sessionKey) return;
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, 0, PHONE, bound(value, 0, 540_000), validBefore, key);
        try IUSDC3009(address(usdc))
            .transferWithAuthorization(
                address(errand), PHONE, bound(value, 0, 540_000), 0, validBefore, rungs[0].nonce, sig
            ) {}
            catch {}
    }

    function strangerRefund() external {
        try errand.refund() {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 3 days));
    }
}

contract InvariantsTest is LadderBase {
    MockUSDC usdc;
    Errand errand;
    Handler handler;
    uint256 constant FUNDED = 30_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        token = IERC20(address(usdc));
        factory = new ErrandFactory(token);
        _setUpPlan();
        usdc.mint(factory.predict(owner, sessionSigner, expiry, root), FUNDED);
        errand = factory.open(owner, sessionSigner, expiry, root);
        handler = new Handler(usdc, errand, factory);
        targetContract(address(handler));
    }

    /// Money is only ever at the errand, with the owner, or with a committed payee.
    function invariant_moneyOnlyGoesWhereCommitted() public view {
        uint256 sum = usdc.balanceOf(address(errand)) + usdc.balanceOf(owner) + usdc.balanceOf(PHONE)
            + usdc.balanceOf(HUMAN) + usdc.balanceOf(MAIL);
        assertEq(sum, FUNDED);
        assertEq(usdc.totalSupply(), FUNDED);
    }

    /// No payee ever receives more than its rung's cap.
    function invariant_payeesWithinCaps() public view {
        assertLe(usdc.balanceOf(PHONE), 540_000);
        assertLe(usdc.balanceOf(HUMAN), 15_000_000);
        assertLe(usdc.balanceOf(MAIL), 14_400_000);
    }

    /// The owner only ever receives money through a refund, which closes the errand.
    function invariant_ownerPaidOnlyByRefund() public view {
        if (usdc.balanceOf(owner) > 0) assertTrue(errand.closed());
    }
}
