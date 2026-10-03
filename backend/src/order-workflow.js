const transitions = {
    seller: {
        pending: ["accepted", "rejected"],
        paid: ["in_progress"],
        in_progress: ["ready"]
    },
    buyer: {
        pending: ["cancelled"],
        accepted: ["cancelled"],
        ready: ["completed"]
    }
};

export function canTransitionOrder({ isSeller, currentStatus, nextStatus, paymentStatus }) {
    const allowed = transitions[isSeller ? "seller" : "buyer"][currentStatus] ?? [];
    if (!allowed.includes(nextStatus)) return false;
    if (isSeller && ["in_progress", "ready"].includes(nextStatus) &&
        paymentStatus !== "approved") {
        return false;
    }
    if (!isSeller && currentStatus === "accepted" && nextStatus === "cancelled" &&
        paymentStatus === "pending") {
        return false;
    }
    return true;
}
