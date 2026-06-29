/**
 * 統合メッセージ機能の共有型・定数（plain・"use server" なし）
 *
 * 周知（全体配信）＋ 個別連絡 ＋ 問い合わせ を1つの「メッセージ」に統合。
 * - messages         : 1通の本文＋宛先定義
 * - message_targets  : 受信者1人=1行（=スレッド単位・既読管理）
 * - message_replies  : 各スレッド内の返信（双方向）
 *
 * 「全員宛でも返信は受信者ごとの個別スレッド」になるため荒れない。
 */

/** 宛先種別 */
export type AudienceType =
  | "all"      // 全員
  | "section"  // セクション指定
  | "staff"    // 複数 or 個人指定
  | "admins";  // スタッフ→管理者（旧・問い合わせ）

export const AUDIENCE_LABEL: Record<AudienceType, string> = {
  all:     "全員",
  section: "セクション",
  staff:   "個別",
  admins:  "管理者へ",
};

/** スレッド内の1返信 */
export type MessageReply = {
  id: string;
  authorStaffId: string;
  authorName: string;
  body: string;
  createdAt: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
};

/** 管理者ビュー：1通＋受信者ごとのスレッド束 */
export type AdminThread = {
  staffId: string;
  staffName: string;
  staffReadAt: string | null;
  adminReadAt: string | null;
  replies: MessageReply[];
  /** 管理者が見るべき新着（スタッフの返信 or 未読の問い合わせ本文）があるか */
  needsAttention: boolean;
};

export type AdminMessage = {
  id: string;
  title: string | null;
  body: string;
  audienceType: AudienceType;
  audienceSections: string[] | null;
  isPinned: boolean;
  allowReply: boolean;
  attachmentUrl: string | null;
  attachmentName: string | null;
  senderStaffId: string;
  senderName: string;
  createdAt: string;
  threads: AdminThread[];
};

/** スタッフビュー：自分の1スレッド */
export type StaffMessage = {
  messageId: string;
  title: string | null;
  body: string;
  audienceType: AudienceType;
  isPinned: boolean;
  allowReply: boolean;
  attachmentUrl: string | null;
  attachmentName: string | null;
  senderStaffId: string;
  senderName: string;
  createdAt: string;
  replies: MessageReply[];
  /** 自分が発信者（管理者へ送った問い合わせ）か */
  iAmSender: boolean;
  /** 未読（自分宛の新着がある）か */
  hasUnread: boolean;
};

/** スタッフ別チャットルームの1吹き出し */
export type RoomItem = {
  id: string;
  side: "admin" | "staff";
  authorName: string;
  body: string;
  createdAt: string;
  /** 配信（全員/セクション）由来の吹き出しか */
  isBroadcast: boolean;
  /** 添付（個別トーク/配信本文に紐づくもの） */
  attachmentUrl: string | null;
  attachmentName: string | null;
};

/** スタッフ別チャットルーム（LINE風一覧の1人ぶん） */
export type StaffRoom = {
  staffId: string;
  staffName: string;
  items: RoomItem[];
  lastActivityAt: string | null;
  lastSnippet: string;
  /** 管理者視点で未確認のスタッフ発言数 */
  unreadCount: number;
};

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"]);

/** 添付が画像か */
export function isImageFile(name: string | null): boolean {
  if (!name) return false;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}
