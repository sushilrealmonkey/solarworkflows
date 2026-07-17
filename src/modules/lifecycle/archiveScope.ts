import type { ArchiveScope } from "./types";

type ArchiveAwareRecord = {
  archived_at?: unknown;
};

export function isRecordArchived(record: ArchiveAwareRecord) {
  const archivedAt = record.archived_at;

  if (typeof archivedAt === "string") {
    return archivedAt.trim().length > 0;
  }

  return archivedAt !== null && archivedAt !== undefined;
}

export function filterByArchiveScope<T extends ArchiveAwareRecord>(
  records: T[],
  scope: ArchiveScope = "active",
) {
  if (scope === "all") {
    return records;
  }

  const showArchived = scope === "archived";
  return records.filter((record) => isRecordArchived(record) === showArchived);
}
