export type InAppNotification = {
  receipt_id: string;
  event_id: string;
  event_type: string;
  title: string;
  message: string;
  module: string;
  record_label: string;
  actor_name: string;
  destination_route: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  read_at: string | null;
};

export type NotificationCursor = {
  createdAt: string;
  id: string;
};
