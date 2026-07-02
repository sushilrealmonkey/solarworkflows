export type QuotationWorkflowSummary = {
  status: string | null;
};

export type QuotationWorkflowState =
  | "none"
  | "waiting"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

const terminalStates: QuotationWorkflowState[] = [
  "rejected",
  "expired",
  "cancelled",
];

export function quotationWorkflowState(
  quotations: QuotationWorkflowSummary[] | null | undefined,
): QuotationWorkflowState {
  if (!quotations || quotations.length === 0) {
    return "none";
  }

  if (quotations.some((quotation) => quotation.status === "accepted")) {
    return "accepted";
  }

  const terminalStatus = terminalStates.find((status) =>
    quotations.some((quotation) => quotation.status === status),
  );

  return terminalStatus ?? "waiting";
}

export function quotationWorkflowPillLabel(state: QuotationWorkflowState) {
  if (state === "rejected") {
    return "Quotation rejected";
  }

  if (state === "expired") {
    return "Quotation expired";
  }

  if (state === "cancelled") {
    return "Quotation cancelled";
  }

  if (state === "accepted") {
    return "Quotation accepted";
  }

  return "Waiting for quotation approval";
}

