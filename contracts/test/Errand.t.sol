// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Errand} from "../src/Errand.sol";
import {ErrandFactory} from "../src/ErrandFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {LadderBase, IUSDC3009} from "./LadderBase.sol";

contract ErrandTest is LadderBase {
    MockUSDC usdc;
    Errand errand;

    function setUp() public {
        usdc = new MockUSDC();
        token = IERC20(address(usdc));
        factory = new ErrandFactory(token);
        _setUpPlan();
        address predicted = factory.predict(owner, sessionSigner, expiry, root);
        usdc.mint(predicted, 30_000_000); // funded before it exists
        errand = factory.open(owner, sessionSigner, expiry, root);
        assertEq(address(errand), predicted);
    }

    // --- opening ---------------------------------------------------------

    function test_openIsIdempotent() public {
        assertEq(address(factory.open(owner, sessionSigner, expiry, root)), address(errand));
    }

    function test_initializeOnlyOnceAndOnlyByFactory() public {
        vm.expectRevert(Errand.NotFactory.selector);
        errand.initialize(address(1), address(2), 3, bytes32(0));
        vm.prank(address(factory));
        vm.expectRevert(Errand.AlreadyInitialized.selector);
        errand.initialize(address(1), address(2), 3, bytes32(0));
    }

    function test_implementationIsLocked() public {
        Errand impl = factory.implementation();
        vm.prank(address(factory));
        vm.expectRevert(Errand.AlreadyInitialized.selector);
        impl.initialize(owner, sessionSigner, expiry, root);
    }

    function test_cannotOpenExpired() public {
        vm.expectRevert(ErrandFactory.ExpiryInPast.selector);
        factory.open(owner, sessionSigner, uint64(block.timestamp), root);
    }

    function test_termsFixTheAddress() public view {
        assertTrue(factory.predict(owner, sessionSigner, expiry, bytes32(uint256(root) ^ 1)) != address(errand));
        assertTrue(factory.predict(address(0xBEEF), sessionSigner, expiry, root) != address(errand));
    }

    // --- paying rungs ----------------------------------------------------

    function test_paysEachRungOnceWithinItsCap() public {
        _pay(errand, 0, 540_000);
        _pay(errand, 2, 11_400_000);
        assertEq(usdc.balanceOf(PHONE), 540_000);
        assertEq(usdc.balanceOf(MAIL), 11_400_000);
        assertEq(usdc.balanceOf(address(errand)), 30_000_000 - 540_000 - 11_400_000);
    }

    function test_rungCannotBeUsedTwice() public {
        _pay(errand, 0, 500_000);
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, 0, PHONE, 40_000, validBefore, sessionKey);
        vm.expectRevert(MockUSDC.AuthorizationUsed.selector);
        IUSDC3009(address(usdc))
            .transferWithAuthorization(address(errand), PHONE, 40_000, 0, validBefore, rungs[0].nonce, sig);
    }

    function test_rejectsOverCap() public {
        assertEq(_check(0, PHONE, 540_001, sessionKey), bytes4(0xffffffff));
    }

    function test_rejectsUncommittedPayee() public {
        assertEq(_check(0, makeAddr("thief"), 1, sessionKey), bytes4(0xffffffff));
    }

    function test_rejectsWrongSigner() public {
        assertEq(_check(0, PHONE, 1, 0xB0B), bytes4(0xffffffff));
    }

    function test_rejectsValidBeyondExpiry() public {
        bytes memory sig = _authSig(errand, 0, PHONE, 1, uint256(expiry) + 1, sessionKey);
        bytes32 digest = errand.authorizationDigest(PHONE, 1, 0, uint256(expiry) + 1, rungs[0].nonce);
        assertEq(errand.isValidSignature(digest, sig), bytes4(0xffffffff));
    }

    function test_rejectsDigestMismatch() public {
        bytes memory sig = _authSig(errand, 0, PHONE, 100, block.timestamp + 300, sessionKey);
        bytes32 other = errand.authorizationDigest(PHONE, 200, 0, block.timestamp + 300, rungs[0].nonce);
        assertEq(errand.isValidSignature(other, sig), bytes4(0xffffffff));
    }

    function test_rejectsShortAndEcdsaShapedSignatures() public view {
        bytes32 digest = errand.authorizationDigest(PHONE, 1, 0, block.timestamp + 300, rungs[0].nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionKey, digest);
        assertEq(errand.isValidSignature(digest, abi.encodePacked(r, s, v)), bytes4(0xffffffff));
        assertEq(errand.isValidSignature(digest, ""), bytes4(0xffffffff));
    }

    function test_rejectsAfterExpiry() public {
        vm.warp(expiry);
        assertEq(_check(0, PHONE, 1, sessionKey), bytes4(0xffffffff));
    }

    function test_rejectsPermitStyleHash() public view {
        // A session signature over some other hash (e.g. an EIP-2612 permit digest) must never validate.
        bytes32 permitDigest = keccak256("permit-for-attacker");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionKey, permitDigest);
        Errand.RungAuth memory a = Errand.RungAuth({
            to: PHONE,
            value: 1,
            validAfter: 0,
            validBefore: block.timestamp + 300,
            nonce: rungs[0].nonce,
            max: rungs[0].max,
            salt: rungs[0].salt,
            proof: _proof(0),
            sessionSig: abi.encodePacked(r, s, v)
        });
        assertEq(errand.isValidSignature(permitDigest, abi.encode(a)), bytes4(0xffffffff));
    }

    // --- refunds ---------------------------------------------------------

    function test_ownerRefundsAnytimeAndClosesErrand() public {
        _pay(errand, 0, 540_000);
        vm.prank(owner);
        errand.refund();
        assertEq(usdc.balanceOf(owner), 30_000_000 - 540_000);
        assertTrue(errand.closed());
        assertEq(_check(2, MAIL, 1, sessionKey), bytes4(0xffffffff));
    }

    function test_strangerCannotRefundEarly() public {
        vm.expectRevert(Errand.NotAllowed.selector);
        errand.refund();
    }

    function test_anyoneRefundsAfterExpiryToOwnerOnly() public {
        vm.warp(expiry);
        vm.prank(makeAddr("anyone"));
        errand.refund();
        assertEq(usdc.balanceOf(owner), 30_000_000);
    }

    function test_gaslessRefundWithSessionSig() public {
        bytes memory sig = _refundSig(errand, sessionKey);
        vm.prank(makeAddr("relayer"));
        errand.refundWithSig(sig);
        assertEq(usdc.balanceOf(owner), 30_000_000);
    }

    function test_refundWithSigRejectsOtherSigner() public {
        bytes memory sig = _refundSig(errand, 0xB0B);
        vm.expectRevert(Errand.BadRefundSignature.selector);
        errand.refundWithSig(sig);
    }

    function test_sweepReturnsStrayTokensToOwner() public {
        MockUSDC other = new MockUSDC();
        other.mint(address(errand), 5);
        vm.prank(owner);
        errand.sweep(IERC20(address(other)));
        assertEq(other.balanceOf(owner), 5);
    }

    // --- fuzz ------------------------------------------------------------

    function testFuzz_onlyCommittedPayeesWithinCaps(uint256 i, address to, uint256 value) public view {
        i = bound(i, 0, 2);
        bytes4 res = _check(i, to, value, sessionKey);
        if (res == bytes4(0x1626ba7e)) {
            assertEq(to, rungs[i].to);
            assertLe(value, rungs[i].max);
        }
    }

    function testFuzz_strangerKeyNeverValidates(uint256 key, uint256 value) public view {
        key = bound(key, 1, type(uint128).max);
        vm.assume(key != sessionKey);
        assertEq(_check(0, PHONE, bound(value, 0, 540_000), key), bytes4(0xffffffff));
    }

    function _check(uint256 i, address to, uint256 value, uint256 key) internal view returns (bytes4) {
        uint256 validBefore = block.timestamp + 300;
        bytes memory sig = _authSig(errand, i, to, value, validBefore, key);
        bytes32 digest = errand.authorizationDigest(to, value, 0, validBefore, rungs[i].nonce);
        return errand.isValidSignature(digest, sig);
    }
}
