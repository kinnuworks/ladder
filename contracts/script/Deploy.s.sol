// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ErrandFactory} from "../src/ErrandFactory.sol";

contract Deploy is Script {
    IERC20 constant BASE_USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);

    function run() external returns (ErrandFactory factory) {
        vm.startBroadcast();
        factory = new ErrandFactory(BASE_USDC);
        vm.stopBroadcast();
        console.log("ErrandFactory", address(factory));
        console.log("Errand implementation", address(factory.implementation()));
    }
}
