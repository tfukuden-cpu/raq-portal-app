export const RULE_CONFIG = [
  {
    key:   "deadline_day",
    label: "申請期限日",
    unit:  "日",
    hint:  "翌月分の希望休を毎月XX日までに申請",
  },
  {
    key:   "monthly_limit_per_person",
    label: "月上限（1人あたり）",
    unit:  "日",
    hint:  "1人が1ヶ月に申請できる上限日数",
  },
  {
    key:   "daily_limit_count",
    label: "日上限（同時申請）",
    unit:  "人",
    hint:  "同じ日に同時に申請できる人数の上限",
  },
  {
    key:   "consecutive_limit",
    label: "連続申請上限",
    unit:  "日",
    hint:  "連続して申請できる日数の上限",
  },
] as const;

export type RuleKey = typeof RULE_CONFIG[number]["key"];

export type HolidayRuleInput = {
  rule_type: string;
  value: string; // string for form input state
};

export const DEFAULT_HOLIDAY_RULES: HolidayRuleInput[] = [
  { rule_type: "deadline_day",             value: "20" },
  { rule_type: "monthly_limit_per_person", value: "3"  },
];

export function getRuleConfig(key: string) {
  return RULE_CONFIG.find((r) => r.key === key);
}
