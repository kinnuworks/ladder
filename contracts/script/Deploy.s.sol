// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ErrandFactory} from "../src/ErrandFactory.sol";

/// Deploys from the relayer's first transaction. The plugin bundle has these addresses built in,
/// so the script refuses to run if they would come out different.
contract Deploy is Script {
    IERC20 constant BASE_USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    address constant EXPECTED_FACTORY = 0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c;
    address constant EXPECTED_IMPLEMENTATION = 0xc580544b22560C97f360d3e40Fb48464D85E7c06;

    function run() external returns (ErrandFactory factory) {
        bool live = block.chainid == 8453 && msg.sender == 0x19591DDf7D49C8b41Ff1FcC0d0d83c8718eD182B;
        if (live) {
            require(vm.getNonce(msg.sender) == 0, "relayer nonce is not 0; addresses would not match the plugin");
        }
        vm.startBroadcast();
        factory = new ErrandFactory(BASE_USDC);
        vm.stopBroadcast();
        if (live) {
            require(address(factory) == EXPECTED_FACTORY, "factory address mismatch");
            require(address(factory.implementation()) == EXPECTED_IMPLEMENTATION, "implementation address mismatch");
        }
        console.log("ErrandFactory", address(factory));
        console.log("Errand implementation", address(factory.implementation()));
    }
}
