// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Errand} from "../src/Errand.sol";
import {ErrandFactory} from "../src/ErrandFactory.sol";
import {LadderBase, IUSDC3009} from "./LadderBase.sol";

/// @dev Runs against real Base USDC (FiatTokenV2_2). This is the path an x402 facilitator takes when it
///      settles a payment from an errand: the bytes-signature `transferWithAuthorization`, which checks
///      the errand with ERC-1271. Skipped when BASE_RPC_URL is not set.
contract ForkTest is LadderBase {
    IERC20 constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    Errand errand;
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        live = true;
        token = USDC;
        factory = new ErrandFactory(USDC);
        _setUpPlan();
        address predicted = factory.predict(owner, sessionSigner, expiry, root);
        deal(address(USDC), predicted, 30_000_000);
        errand = factory.open(owner, sessionSigner, expiry, root);
    }

    function test_fork_realUsdcSettlesErrandPayment() public {
        if (!live) return;
        uint256 before = USDC.balanceOf(PHONE);
        vm.prank(makeAddr("facilitator"));
        _pay(errand, 0, 540_000);
        assertEq(USDC.balanceOf(PHONE) - before, 540_000);
    }

    function test_fork_realUsdcRejectsUncommittedPayee() public {
        if (!live) return;
        address thief = makeAddr("thief");
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, 0, thief, 540_000, validBefore, sessionKey);
        vm.expectRevert();
        IUSDC3009(address(USDC))
            .transferWithAuthorization(address(errand), thief, 540_000, 0, validBefore, rungs[0].nonce, sig);
    }

    function test_fork_realUsdcRejectsReplay() public {
        if (!live) return;
        _pay(errand, 0, 540_000);
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, 0, PHONE, 540_000, validBefore, sessionKey);
        vm.expectRevert();
        IUSDC3009(address(USDC))
            .transferWithAuthorization(address(errand), PHONE, 540_000, 0, validBefore, rungs[0].nonce, sig);
    }

    function test_fork_refundToOwner() public {
        if (!live) return;
        _pay(errand, 2, 11_400_000);
        vm.prank(makeAddr("relayer"));
        errand.refundWithSig(_refundSig(errand, sessionKey));
        assertEq(USDC.balanceOf(owner), 30_000_000 - 11_400_000);
    }
}
