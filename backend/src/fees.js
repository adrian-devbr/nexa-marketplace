export function calculateFeeCents(totalCents, rateBasisPoints) {
    if (!Number.isSafeInteger(totalCents) || totalCents < 0 ||
        !Number.isSafeInteger(rateBasisPoints) ||
        rateBasisPoints < 0 || rateBasisPoints > 10000) {
        throw new RangeError("Valor e porcentagem da taxa inválidos.");
    }
    const numerator = BigInt(totalCents) * BigInt(rateBasisPoints) + 5000n;
    const feeCents = Number(numerator / 10000n);
    if (!Number.isSafeInteger(feeCents)) {
        throw new RangeError("O valor da taxa excede o limite permitido.");
    }
    return feeCents;
}

export function validateFeeTierSequence(tiers) {
    if (!Array.isArray(tiers) || tiers.length === 0 ||
        tiers[0].minCents !== 0 || tiers.at(-1).maxCents !== null) {
        return false;
    }
    return tiers.every((tier, index) => {
        if (!Number.isSafeInteger(tier.minCents) || tier.minCents < 0 ||
            !Number.isSafeInteger(tier.rateBasisPoints) ||
            tier.rateBasisPoints < 0 || tier.rateBasisPoints > 10000) {
            return false;
        }
        if (tier.maxCents !== null &&
            (!Number.isSafeInteger(tier.maxCents) || tier.maxCents < tier.minCents)) {
            return false;
        }
        const next = tiers[index + 1];
        return !next || (tier.maxCents !== null && next.minCents === tier.maxCents + 1);
    });
}
