from dataclasses import dataclass


@dataclass(frozen=True)
class RiskFacts:
    successful_deliveries: int = 0
    returns: int = 0
    shipped_cancellations: int = 0
    phone_verified: bool = False
    duplicate_recent_order: bool = False
    complete_address: bool = True
    prior_orders: int = 0


@dataclass(frozen=True)
class RiskResult:
    score: int
    level: str
    reasons: list[str]
    recommendation: str


def calculate_cod_risk(facts: RiskFacts) -> RiskResult:
    score = 0
    reasons: list[str] = []
    outcomes = facts.successful_deliveries + facts.returns
    if outcomes and facts.returns / outcomes > 0.5:
        score += 30
        reasons.append("Return ratio is above 50%")
    if facts.successful_deliveries == 0:
        score += 20
        reasons.append("No successful deliveries")
    if not facts.phone_verified:
        score += 15
        reasons.append("Phone is unverified")
    if facts.duplicate_recent_order:
        score += 15
        reasons.append("Similar order placed within 30 minutes")
    if not facts.complete_address:
        score += 10
        reasons.append("Delivery address is incomplete")
    if facts.shipped_cancellations:
        score += 10
        reasons.append("Previous cancellation after shipment")
    if facts.successful_deliveries > 5:
        score -= 20
        reasons.append("More than five successful deliveries")
    if facts.prior_orders:
        score -= 10
        reasons.append("Repeat customer")
    score = max(0, min(100, score))
    level = (
        "LOW" if score < 25 else "MEDIUM" if score < 50 else "HIGH" if score < 75 else "VERY_HIGH"
    )
    recommendation = (
        "Proceed normally"
        if level == "LOW"
        else "Verify address before dispatch"
        if level == "MEDIUM"
        else "Call customer before dispatch"
        if level == "HIGH"
        else "Require advance payment or manager approval"
    )
    return RiskResult(score, level, reasons, recommendation)
