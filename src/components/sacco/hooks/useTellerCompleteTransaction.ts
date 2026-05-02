import { useCallback, useRef, useState } from "react";
import {
  glHintForTask,
  postingPurposeForTask,
  resolveTellerCounterpartyGlId,
  resolveTellerEntryMode,
  successMessageForMode,
  TELLER_VAL,
  taskRequiresMemberOnly,
  taskRequiresSavingsAccount,
} from "@/lib/saccoTellerConfig";
import {
  createTellerTransaction,
  type SaccoTellerTxnType,
  type TellerDashboardSnapshot,
  type TellerInitData,
  type TellerMemberPickRow,
  type TellerSavingsAccountPickRow,
} from "@/lib/saccoTellerDb";
import type { TellerTaskAction } from "@/lib/saccoTellerConfig";

export type TellerFieldErrors = { amount?: string; member?: string; account?: string; gl?: string };

export type UseTellerCompleteTransactionArgs = {
  canMutate: boolean;
  organizationId: string | null;
  staffId: string | undefined;
  snap: TellerDashboardSnapshot | null;
  init: TellerInitData | null;
  load: (opts?: { silent?: boolean }) => Promise<void>;
  refreshSaccoWorkspace: () => void | Promise<void>;
  setSaving: (v: boolean) => void;
  setActionMessage: (v: { kind: "ok" | "err"; text: string } | null) => void;
  taskAction: TellerTaskAction;
  selectedMemberId: string;
  selectedSavingsAccountId: string;
  amountStr: string;
  narration: string;
  chequeNo: string;
  chequeBank: string;
  chequeAmountStr: string;
  chequeValueDate: string;
  chequePayeeRef: string;
  chequeFlow: "received" | "paid" | "clearing";
  setAmountStr: (v: string) => void;
  setNarration: (v: string) => void;
  setChequeNo: (v: string) => void;
  setChequeBank: (v: string) => void;
  setChequeAmountStr: (v: string) => void;
  setChequeValueDate: (v: string) => void;
  setChequePayeeRef: (v: string) => void;
  setSelectedMemberId: (v: string) => void;
  setSelectedSavingsAccountId: (v: string) => void;
  setMemberSearch: (v: string) => void;
};

/**
 * Single primary button — completes transaction and refreshes snapshot/init via load().
 * Uses a ref so the handler stays stable while always seeing latest form fields.
 */
export function useTellerCompleteTransaction(args: UseTellerCompleteTransactionArgs) {
  const [fieldMsg, setFieldMsg] = useState<TellerFieldErrors>({});
  const argsRef = useRef(args);
  argsRef.current = args;

  const doComplete = useCallback(async (): Promise<boolean> => {
    const {
      canMutate,
      organizationId,
      staffId,
      snap,
      init,
      load,
      refreshSaccoWorkspace,
      setSaving,
      setActionMessage,
      taskAction,
      selectedMemberId,
      selectedSavingsAccountId,
      amountStr,
      narration,
      chequeNo,
      chequeBank,
      chequeAmountStr,
      chequeValueDate,
      chequePayeeRef,
      chequeFlow,
      setAmountStr,
      setNarration,
      setChequeNo,
      setChequeBank,
      setChequeAmountStr,
      setChequeValueDate,
      setChequePayeeRef,
      setSelectedMemberId,
      setSelectedSavingsAccountId,
      setMemberSearch,
    } = argsRef.current;

    if (!canMutate || !organizationId || !staffId) return false;
    setSaving(true);
    setActionMessage(null);
    setFieldMsg({});
    try {
      const sess = snap?.openSession;
      if (!sess) {
        setActionMessage({ kind: "err", text: TELLER_VAL.noSession });
        return false;
      }

      const pickMembers = init?.members ?? [];
      const pickSavingsAccounts = init?.savingsAccounts ?? [];
      const glList = init?.glAccounts ?? [];
      const journalTellerGl = {
        allowPerTxn: init?.tellerAllowPerTxnCounterpartyGl ?? true,
        defaultId: init?.tellerDefaultCounterpartyGlId ?? null,
      };

      const purpose = postingPurposeForTask(taskAction);
      const hint = glHintForTask(taskAction);
      const cpId = resolveTellerCounterpartyGlId({
        allowPerTxn: journalTellerGl.allowPerTxn,
        defaultId: journalTellerGl.defaultId,
        glAccounts: glList,
        hint,
      });

      let saccoMemberId: string | null = null;
      let saccoMemberSavingsAccountId: string | null = null;
      let memRef: string | null = null;

      if (taskRequiresSavingsAccount(taskAction)) {
        if (!selectedMemberId) {
          setFieldMsg({ member: TELLER_VAL.noMember });
          return false;
        }
        if (!selectedSavingsAccountId) {
          setFieldMsg({ account: TELLER_VAL.noSavings });
          return false;
        }
        const acc = pickSavingsAccounts.find((a: TellerSavingsAccountPickRow) => a.id === selectedSavingsAccountId);
        if (!acc) throw new Error("Savings account not found — refresh the page.");
        saccoMemberId = acc.sacco_member_id;
        saccoMemberSavingsAccountId = acc.id;
        memRef = `${acc.member_number} — ${acc.full_name} (${acc.account_number} · ${acc.savings_product_code})`;
      } else if (taskAction === "cheque") {
        if (selectedMemberId) {
          const mem = pickMembers.find((m: TellerMemberPickRow) => m.id === selectedMemberId);
          if (mem) {
            saccoMemberId = mem.id;
            memRef = `${mem.member_number} — ${mem.full_name}`;
          }
        }
        const payee = chequePayeeRef.trim();
        if (payee) memRef = memRef ? `${memRef} · ${payee}` : payee;
      } else if (taskRequiresMemberOnly(taskAction)) {
        if (!selectedMemberId) {
          setFieldMsg({ member: TELLER_VAL.noMember });
          return false;
        }
        const mem = pickMembers.find((m: TellerMemberPickRow) => m.id === selectedMemberId);
        if (!mem) throw new Error("Member not found — refresh the page.");
        saccoMemberId = mem.id;
        memRef = `${mem.member_number} — ${mem.full_name}`;
      }

      let txnType: SaccoTellerTxnType;
      let useAmt = amountStr;
      let nar = narration.trim() || null;
      const chq: { chequeNumber?: string | null; chequeBank?: string | null; chequeValueDate?: string | null } = {};

      if (taskAction === "deposit") txnType = "cash_deposit";
      else if (taskAction === "withdraw") txnType = "cash_withdrawal";
      else if (taskAction === "cheque") {
        useAmt = chequeAmountStr;
        Object.assign(chq, {
          chequeNumber: chequeNo.trim() || null,
          chequeBank: chequeBank.trim() || null,
          chequeValueDate: chequeValueDate || null,
        });
        if (chequeFlow === "received") txnType = "cheque_received";
        else if (chequeFlow === "paid") txnType = "cheque_paid";
        else txnType = "cheque_clearing";
      } else {
        txnType = "cash_deposit";
      }

      const amt = Number(useAmt);
      if (taskAction === "cheque") {
        if (!Number.isFinite(amt) || amt < 0) {
          setFieldMsg({ amount: TELLER_VAL.noChequeAmount });
          return false;
        }
      } else {
        if (!Number.isFinite(amt) || amt < 0) {
          setFieldMsg({ amount: TELLER_VAL.noAmount });
          return false;
        }
      }

      if (txnType === "cash_deposit" || txnType === "cash_withdrawal") {
        if (!cpId) {
          setFieldMsg({ gl: TELLER_VAL.noGl });
          return false;
        }
      }

      const sessionVolume = (snap?.sessionReceiptsTotal ?? 0) + (snap?.sessionPaymentsTotal ?? 0);
      const mode = resolveTellerEntryMode({ amount: Math.round(amt), sessionSessionVolume: sessionVolume });

      await createTellerTransaction({
        organizationId,
        staffId,
        sessionId: sess.id,
        txnType,
        amount: Math.round(amt),
        saccoMemberId,
        saccoMemberSavingsAccountId,
        postingPurpose: purpose,
        counterpartyGlAccountId: txnType === "cash_deposit" || txnType === "cash_withdrawal" ? cpId : null,
        memberRef: memRef,
        narration: nar,
        ...chq,
        mode,
      });

      if (taskAction !== "cheque") {
        setAmountStr("");
        setNarration("");
      } else {
        setChequeNo("");
        setChequeBank("");
        setChequeAmountStr("");
        setChequeValueDate("");
        setChequePayeeRef("");
        setNarration("");
      }
      setSelectedMemberId("");
      setSelectedSavingsAccountId("");
      setMemberSearch("");
      setFieldMsg({});

      setActionMessage({ kind: "ok", text: successMessageForMode(taskAction, mode) });
      await load({ silent: true });
      await refreshSaccoWorkspace();
      return true;
    } catch (e) {
      setActionMessage({ kind: "err", text: e instanceof Error ? e.message : "Action failed" });
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { doComplete, fieldMsg, setFieldMsg };
}
