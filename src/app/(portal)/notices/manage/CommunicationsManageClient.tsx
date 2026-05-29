"use client";

import { useState } from "react";
import NoticesManageClient from "./NoticesManageClient";
import { InquiryManageClient } from "../../inquiries/manage/InquiryManageClient";

type Notice = {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  posted_by: string;
  poster_name: string;
  target_staff_id: string | null;
  target_name: string | null;
};

type Inquiry = {
  id: string;
  staffName: string;
  title: string;
  body: string;
  status: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
};

type Tab = "notices" | "inquiries";

interface Props {
  notices: Notice[];
  inquiries: Inquiry[];
}

export default function CommunicationsManageClient({ notices, inquiries }: Props) {
  const [tab, setTab] = useState<Tab>("notices");

  const openCount = inquiries.filter(i => i.status === "open").length;

  return (
    <>
      {/* タブ切り替え */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-5">
        <button
          type="button"
          onClick={() => setTab("notices")}
          className={[
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
            tab === "notices"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
          ].join(" ")}
        >
          周知事項
        </button>
        <button
          type="button"
          onClick={() => setTab("inquiries")}
          className={[
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5",
            tab === "inquiries"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
          ].join(" ")}
        >
          問い合わせ
          {openCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none">
              {openCount > 9 ? "9+" : openCount}
            </span>
          )}
        </button>
      </div>

      {tab === "notices" ? (
        <NoticesManageClient notices={notices} />
      ) : (
        <InquiryManageClient inquiries={inquiries} />
      )}
    </>
  );
}
