const STATUS = new Set(["pending", "approved", "reversed", "clawback"]);
const COMPLIANCE = Object.freeze({ GREEN: 1, YELLOW: 0.55, RED: 0, HELD: 0 });

export function normalizeCommissionTransaction(network, row) {
  const status = String(row.status || "").toLowerCase();
  if (!STATUS.has(status)) throw new Error("commission_status_invalid");
  const amount = Number(row.commission_amount);
  if (!Number.isFinite(amount)) throw new Error("commission_amount_invalid");
  if (!/^c1-[a-f0-9]{24}$/.test(row.click_token || "")) throw new Error("commission_click_token_invalid");
  if (!row.transaction_id || !/^20\d{2}-\d{2}-\d{2}/.test(row.effective_at || "")) throw new Error("commission_identity_invalid");
  const signed = ["reversed", "clawback"].includes(status) ? -Math.abs(amount) : Math.abs(amount);
  return { network, transaction_id: String(row.transaction_id), click_token: row.click_token, program_id: String(row.program_id || ""), status, gross_commission: Math.abs(amount), net_commission: signed, currency: String(row.currency || "USD").toUpperCase(), effective_at: row.effective_at };
}

export function reconcileCommissions({ clicks, transactions, deposits, minimumClicks = 30 }) {
  if (!Number.isInteger(minimumClicks) || minimumClicks < 30) throw new Error("minimum_click_floor_invalid");
  const clickCount = clicks.filter((click) => click.ivt_status === "valid").length;
  const netCommission = transactions.reduce((sum, transaction) => sum + transaction.net_commission, 0);
  const deposited = deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const delta = Math.round((deposited - netCommission) * 100) / 100;
  return {
    valid_clicks: clickCount,
    net_commission: Math.round(netCommission * 100) / 100,
    actual_deposits: Math.round(deposited * 100) / 100,
    deposit_delta: delta,
    epc: clickCount ? Math.round((netCommission / clickCount) * 10000) / 10000 : null,
    sample_gate: clickCount >= minimumClicks ? "PASS" : "HELD_MINIMUM_SAMPLE",
    deposit_gate: Math.abs(delta) <= 0.01 ? "PASS" : "HELD_DEPOSIT_MISMATCH",
    optimization_action_allowed: clickCount >= minimumClicks && Math.abs(delta) <= 0.01,
    reversals_included: transactions.some((transaction) => ["reversed", "clawback"].includes(transaction.status)),
  };
}

export function scoreProgramForCuration(program) {
  const economics = Number(program.commission_economics);
  const epc = Number(program.verified_epc);
  const samples = Number(program.epc_sample_clicks);
  const recurringMultiplier = program.recurring_flag === true ? 1.35 : program.recurring_flag === false ? 1 : 0;
  const complianceWeight = COMPLIANCE[program.compliance_tier] ?? 0;
  const eligible = economics > 0 && epc >= 0 && samples >= 30 && recurringMultiplier > 0 && complianceWeight > 0 && program.actual_deposit_reconciled === true && program.live_link_allowed === true;
  return { eligible, score: eligible ? Math.round(economics * epc * recurringMultiplier * complianceWeight * 10000) / 10000 : null, sample_gate: samples >= 30 ? "PASS" : "HELD_MINIMUM_SAMPLE" };
}

export function curatePrograms(programs, topK = 4) {
  if (!Number.isInteger(topK) || topK < 1 || topK > 8) throw new Error("top_k_invalid");
  const evaluated = programs.map((program) => ({ program, ...scoreProgramForCuration(program) }));
  const featured = evaluated.filter((item) => item.eligible).sort((a, b) => b.score - a.score || a.program.display_name.localeCompare(b.program.display_name)).slice(0, topK);
  const featuredIds = new Set(featured.map((item) => item.program.program_id));
  return { featured, see_all: evaluated.filter((item) => !featuredIds.has(item.program.program_id)), status: featured.length ? "PASS" : "HELD_NO_ECONOMICS_SAMPLE", formula: "commission_economics × verified_epc × recurring_multiplier × compliance_weight", minimum_clicks: 30 };
}

export const reconciliationPolicy = Object.freeze({ appendOnlyGrossIsForbidden: true, reversalsAndClawbacksRequired: true, actualDepositReconciliationRequired: true, minimumClicks: 30, optimizationOnSingleDigitClicks: false });
