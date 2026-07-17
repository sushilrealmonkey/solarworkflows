import { supabase } from "../../services/supabaseClient";
import type {
  LifecycleAction,
  LifecycleModuleKey,
  LifecyclePreview,
} from "./types";

function rpcError(error: { message: string } | null, fallback: string) {
  if (error) {
    throw new Error(error.message || fallback);
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }
  return supabase;
}

export async function previewRecordLifecycle(
  moduleKey: LifecycleModuleKey,
  recordId: string,
  action: LifecycleAction,
) {
  const { data, error } = await requireSupabase().rpc("preview_record_lifecycle", {
    module_key: moduleKey,
    record_id: recordId,
    action,
  });
  rpcError(error, "Unable to check record dependencies.");
  return data as LifecyclePreview;
}

export async function archiveRecord(
  moduleKey: LifecycleModuleKey,
  recordId: string,
  reason: string,
) {
  const { data, error } = await requireSupabase().rpc("archive_record", {
    module_key: moduleKey,
    record_id: recordId,
    reason,
  });
  rpcError(error, "Unable to archive this record.");
  return data;
}

export async function restoreRecord(
  moduleKey: LifecycleModuleKey,
  recordId: string,
  reason: string,
) {
  const { data, error } = await requireSupabase().rpc("restore_record", {
    module_key: moduleKey,
    record_id: recordId,
    reason,
  });
  rpcError(error, "Unable to restore this record.");
  return data;
}

export async function permanentlyDeleteRecord(
  moduleKey: LifecycleModuleKey,
  recordId: string,
  reason: string,
  confirmation: string,
) {
  const { data, error } = await requireSupabase().rpc("permanently_delete_record", {
    module_key: moduleKey,
    record_id: recordId,
    reason,
    confirmation,
  });
  rpcError(error, "Unable to permanently delete this record.");
  return data as { deleted: boolean; cleanup_queued?: boolean };
}

export async function cancelPaymentRecord(paymentId: string, reason: string) {
  const { data, error } = await requireSupabase().rpc("cancel_payment", {
    payment_id: paymentId,
    reason,
  });
  rpcError(error, "Unable to cancel this payment.");
  return data;
}

export async function reverseInventoryTransaction(
  transactionId: string,
  reason: string,
) {
  const { data, error } = await requireSupabase().rpc("reverse_inventory_transaction", {
    transaction_id: transactionId,
    reason,
  });
  rpcError(error, "Unable to reverse this inventory transaction.");
  return data;
}
