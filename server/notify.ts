/** 2차 알림 연결점. 현재 외부 발송 없음. */
export function notify(_event: {
  academyId: number;
  studentId: string;
  kind: "in" | "out" | "absent" | "invoice_sent";
  at: string;
}) {}
