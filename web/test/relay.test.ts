// Validation for /api/move and /api/finish, decided before anything is sent.
import { type Address, type Hex, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type TransferLog, receivedRunners } from "../lib/errand";
import { checkFinish, checkMove, transferArgs, usd2 } from "../lib/relay";
import type { Sweep } from "../lib/schema";
import { fixture, other, owner, runners } from "./helpers";

const SIG65 = `0x${"11".repeat(64)}1b` as Hex;
const LONG_SIG = `0x${"22".repeat(320)}` as Hex;
const auth = (from: Address, to: Address, value = "540000") => ({
  from,
  to,
  value,
  validAfter: "0",
  validBefore: "2000000000",
  nonce: `0x${"33".repeat(32)}` as Hex,
});

describe("move validation", () => {
  const { errand } = fixture();
  it("accepts a release from the errand with an ERC-1271 blob", () => {
    expect(checkMove({ errand, authorization: auth(errand, runners.phone), signature: LONG_SIG })).toBeNull();
  });
  it("requires the errand as payer", () => {
    expect(checkMove({ errand, authorization: auth(other.address, runners.phone), signature: LONG_SIG })).toMatch(/from must be the errand/);
  });
  it("requires a value above zero", () => {
    expect(checkMove({ errand, authorization: auth(errand, runners.phone, "0"), signature: LONG_SIG })).toMatch(/more than zero/);
  });
  it("refuses a plain 65-byte signature", () => {
    expect(checkMove({ errand, authorization: auth(errand, runners.phone), signature: SIG65 })).toMatch(/ERC-1271/);
  });
  it("uses the bytes overload for the long signature and v,r,s for 65 bytes", () => {
    expect(transferArgs(auth(errand, runners.phone), LONG_SIG)).toHaveLength(7);
    const vrs = transferArgs(auth(runners.phone, owner.address), SIG65);
    expect(vrs).toHaveLength(9);
    expect(vrs[6]).toBe(27);
  });
});

describe("finish validation", () => {
  const { errand } = fixture();
  let n = 0;
  const log = (from: Address, to: Address, value = 540_000n): TransferLog => ({
    from,
    to,
    value,
    tx: `0x${(++n).toString(16).padStart(64, "0")}` as Hex,
    block: 10n,
    logIndex: 0,
  });
  const sweep = (runner: Address, to: Address = owner.address, value = "100000", signature: Hex = SIG65): Sweep => ({
    runner,
    authorization: auth(runner, to, value),
    signature,
  });
  // Mocked Transfer logs: the errand paid the phone runner; the mail runner was paid by someone else.
  const logs = [log(errand, runners.phone), log(other.address, runners.mail), log(errand, getAddress("0x00000000000000000000000000000000000000aa"))];
  const received = receivedRunners(errand, [runners.phone, runners.mail], logs);

  it("finds only runners the errand itself paid", () => {
    expect([...received]).toEqual([runners.phone]);
  });
  it("accepts a sweep to the owner from a runner the errand paid", () => {
    expect(checkFinish({ owner: owner.address, sweeps: [sweep(runners.phone)], received })).toBeNull();
  });
  it("accepts a refund with no sweeps", () => {
    expect(checkFinish({ owner: owner.address, sweeps: [], received: new Set() })).toBeNull();
  });
  it("refuses a sweep to anyone but the owner", () => {
    expect(checkFinish({ owner: owner.address, sweeps: [sweep(runners.phone, other.address)], received })).toMatch(/owner/);
  });
  it("refuses a sweep of zero", () => {
    expect(checkFinish({ owner: owner.address, sweeps: [sweep(runners.phone, owner.address, "0")], received })).toMatch(/more than zero/);
  });
  it("refuses a runner that never received USDC from this errand", () => {
    expect(checkFinish({ owner: owner.address, sweeps: [sweep(runners.mail)], received })).toMatch(/never received/);
  });
  it("refuses an authorization from a different address than the runner", () => {
    const s = { ...sweep(runners.phone), authorization: auth(other.address, owner.address) };
    expect(checkFinish({ owner: owner.address, sweeps: [s], received })).toMatch(/from must be the runner/);
  });
  it("refuses a non-65-byte runner signature and a duplicate runner", () => {
    expect(checkFinish({ owner: owner.address, sweeps: [sweep(runners.phone, owner.address, "1", LONG_SIG)], received })).toMatch(/65-byte/);
    expect(checkFinish({ owner: owner.address, sweeps: [sweep(runners.phone), sweep(runners.phone)], received })).toMatch(/twice/);
  });
  it("formats the refunded total to two decimals", () => {
    expect(usd2(14_520_000n)).toBe("14.52");
    expect(usd2(0n)).toBe("0.00");
  });
});

describe("sweep body", () => {
  it("needs at least one sweep and an errand", async () => {
    const { sweepBodySchema } = await import("../lib/schema");
    const { errand } = fixture();
    expect(sweepBodySchema.safeParse({ errand, sweeps: [] }).success).toBe(false);
    expect(sweepBodySchema.safeParse({ sweeps: [] }).success).toBe(false);
  });
});
