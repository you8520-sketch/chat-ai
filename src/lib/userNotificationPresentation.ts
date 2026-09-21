export type UserNotificationType =
  | "creator_character"
  | "gift_sent"
  | "gift_received"
  | "payment_success"
  | "payment_cancel"
  | "follow_received"
  | "admin_point_grant"
  | "inquiry_reply"
  | "point_expiring"
  | "character_review"
  | "report_result"
  | "character_like"
  | "profile_comment"
  | "post_comment"
  | "notice"
  | "event"
  | "admin_comment_review"
  | "comment_moderation";

export type UserNotificationRow = {
  id: number;
  user_id: number;
  type: UserNotificationType;
  ref_id: number;
  actor_id: number | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  emoji: string | null;
  hue: number | null;
  character_name: string | null;
  actor_nickname: string | null;
  comment_target_type: "creator" | "character" | null;
  comment_target_id: number | null;
};

export type NoticeRow = {
  id: number;
  title: string;
  content: string;
  author_name: string;
  created_at: string;
};

export type NoticeFeedRow = NoticeRow & { unread: boolean };

export function notificationHref(n: Pick<UserNotificationRow, "type" | "ref_id" | "actor_id" | "comment_target_type" | "comment_target_id">): string {
  switch (n.type) {
    case "creator_character":
    case "character_like":
      return `/character/${n.ref_id}`;
    case "profile_comment":
      if (n.comment_target_type === "character" && n.comment_target_id) {
        return `/character/${n.comment_target_id}`;
      }
      if (n.comment_target_type === "creator" && n.comment_target_id) {
        return `/creator/${n.comment_target_id}`;
      }
      return "/notifications";
    case "post_comment":
      return `/board/info?post=${n.ref_id}#post-${n.ref_id}`;
    case "admin_comment_review":
      return "/admin/comment-reports";
    case "comment_moderation":
      return "/notifications";
    case "follow_received":
      return n.actor_id ? `/creator/${n.actor_id}` : "/tab/following";
    case "gift_sent":
    case "gift_received":
    case "payment_success":
    case "payment_cancel":
    case "admin_point_grant":
    case "point_expiring":
      return "/points";
    case "inquiry_reply":
      return "/notifications";
    case "character_review":
      return `/character/${n.ref_id}`;
    case "report_result":
      return "/notifications";
    case "notice":
      return `/notices/${n.ref_id}`;
    case "event":
      return "/";
    default: {
      const _exhaustive: never = n.type;
      return _exhaustive;
    }
  }
}

export function notificationIcon(type: UserNotificationType): string {
  switch (type) {
    case "creator_character":
      return "✨";
    case "gift_sent":
      return "🎁";
    case "gift_received":
      return "💝";
    case "payment_success":
      return "✅";
    case "payment_cancel":
      return "↩️";
    case "admin_point_grant":
      return "🎉";
    case "inquiry_reply":
      return "💬";
    case "point_expiring":
      return "⏳";
    case "character_review":
      return "✅";
    case "report_result":
      return "📋";
    case "follow_received":
      return "👤";
    case "character_like":
      return "❤️";
    case "profile_comment":
    case "post_comment":
      return "💬";
    case "admin_comment_review":
      return "🚨";
    case "comment_moderation":
      return "🛡️";
    case "notice":
      return "📢";
    case "event":
      return "🎉";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
