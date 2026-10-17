// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Errand} from "./Errand.sol";

/// @title ErrandFactory
/// @notice Deploys errand accounts at addresses fixed by their terms, so an errand can be
///         funded before it exists and anyone can check what an address will be allowed to do.
contract ErrandFactory {
    Errand public immutable implementation;

    event ErrandOpened(
        address indexed errand, address indexed owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot
    );

    constructor(IERC20 usdc) {
        implementation = new Errand(usdc);
    }

    function salt(address owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(owner, sessionSigner, expiry, rungsRoot));
    }

    function predict(address owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot)
        public
        view
        returns (address)
    {
        return Clones.predictDeterministicAddress(
            address(implementation), salt(owner, sessionSigner, expiry, rungsRoot), address(this)
        );
    }

    /// @notice Deploy the errand for these terms. Permissionless and idempotent in effect:
    ///         the terms fix the address, so a second caller can only deploy the same thing.
    ///         Opening after the expiry is allowed on purpose: an expired errand can pay nothing,
    ///         but opening it lets anyone return money that was sent to its address to the owner.
    function open(address owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot)
        external
        returns (Errand errand)
    {
        address predicted = predict(owner, sessionSigner, expiry, rungsRoot);
        if (predicted.code.length > 0) return Errand(predicted);
        errand =
            Errand(Clones.cloneDeterministic(address(implementation), salt(owner, sessionSigner, expiry, rungsRoot)));
        errand.initialize(owner, sessionSigner, expiry, rungsRoot);
        emit ErrandOpened(address(errand), owner, sessionSigner, expiry, rungsRoot);
    }
}
