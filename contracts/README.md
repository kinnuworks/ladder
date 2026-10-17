# Ladder contracts

`ErrandFactory` deploys `Errand` accounts at CREATE2 addresses fixed by their terms: owner, session signer, expiry and a Merkle root of steps. An errand answers ERC-1271 `isValidSignature` only for a USDC `transferWithAuthorization` that matches a committed step: the committed payee, at most its cap, with its one-time nonce, before the expiry, signed by the errand's session key. Every refund path pays only the owner.

```bash
forge test                                           # unit, fuzz and invariant tests (fork tests skip)
BASE_RPC_URL=https://mainnet.base.org forge test     # adds fork tests against real Base USDC
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --private-key $RELAYER_PRIVATE_KEY
```
