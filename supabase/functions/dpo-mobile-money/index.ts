import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CollectRequest = {
  action: "collect";
  network: "mtn" | "airtel";
  amount: number;
  currency?: string;
  phone_number: string;
  customer_name?: string;
  customer_email?: string;
  tx_ref: string;
  sale_id?: string;
  organization_id?: string | null;
  payment_method?: string;
  timeout_seconds?: number;
};

type AttemptStatus = "initiated" | "pending" | "successful" | "failed" | "timeout" | "cancelled";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const textOf = (doc: Document, tag: string) => doc.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";

const parseXml = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0]?.textContent;
  if (parserError) throw new Error("Invalid XML response from DPO");
  return doc;
};

const xmlEscape = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const asMoney = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

const phoneForDpo = (raw: string) => raw.replace(/[^\d]/g, "");

const customerNames = (fullName?: string) => {
  const bits = String(fullName || "Retail Customer").trim().split(/\s+/).filter(Boolean);
  if (bits.length === 0) return { first: "Retail", last: "Customer" };
  if (bits.length === 1) return { first: bits[0], last: "Customer" };
  return { first: bits[0], last: bits.slice(1).join(" ") };
};

const normalizeDpoStatus = (result: string, explanation: string): AttemptStatus => {
  if (result === "000" || /paid|approved|successful/i.test(explanation)) return "successful";
  if (/cancel/i.test(explanation)) return "cancelled";
  if (/declin|fail|error|invalid/i.test(explanation)) return "failed";
  return "pending";
};

const dpoPost = async (baseUrl: string, xml: string) => {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/xml", Accept: "application/xml" },
    body: xml,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`DPO HTTP ${res.status}: ${body.slice(0, 300)}`);
  return { body, doc: parseXml(body) };
};

const gatewayConfig = (network: "mtn" | "airtel") => {
  const country = Deno.env.get(network === "mtn" ? "DPO_MTN_COUNTRY" : "DPO_AIRTEL_COUNTRY") || Deno.env.get("DPO_MNO_COUNTRY") || "uganda";
  const mno =
    Deno.env.get(network === "mtn" ? "DPO_MTN_MNO" : "DPO_AIRTEL_MNO") ||
    (network === "mtn" ? "mtn" : "airtel");
  return { country, mno };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const companyToken = Deno.env.get("DPO_COMPANY_TOKEN");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !companyToken) {
    return json({ ok: false, error: "Missing required env" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: authErr } = await authClient.auth.getUser();
  if (authErr || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);

  const payload = (await req.json()) as CollectRequest;
  if (payload.action !== "collect") return json({ ok: false, error: "Unsupported action" }, 400);
  if (!payload.phone_number || !payload.tx_ref || !Number.isFinite(payload.amount) || payload.amount <= 0) {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  const staffOrgRes = await authClient.from("staff").select("organization_id").eq("id", userData.user.id).maybeSingle();
  if (staffOrgRes.error) return json({ ok: false, error: staffOrgRes.error.message }, 500);
  const staffOrganizationId = (staffOrgRes.data as { organization_id?: string | null } | null)?.organization_id ?? null;
  if (!staffOrganizationId) return json({ ok: false, error: "Authenticated staff organization not found" }, 403);
  if (payload.organization_id && payload.organization_id !== staffOrganizationId) {
    return json({ ok: false, error: "Organization mismatch" }, 403);
  }
  const organizationId = staffOrganizationId;

  const baseUrl = Deno.env.get("DPO_BASE_URL") || "https://secure.3gdirectpay.com/API/v6/";
  const timeoutSeconds = Math.min(Math.max(payload.timeout_seconds ?? 60, 15), 120);
  const currency = (payload.currency || "UGX").toUpperCase();
  const { first, last } = customerNames(payload.customer_name);
  const { country, mno } = gatewayConfig(payload.network);
  const serviceType = Deno.env.get("DPO_SERVICE_TYPE");
  const serviceTypeName = Deno.env.get("DPO_SERVICE_TYPE_NAME") || "Retail POS sale";
  const serviceDate = new Date().toISOString().slice(0, 10);

  const writeAttempt = async (status: AttemptStatus, patch: Record<string, unknown> = {}) => {
    await serviceClient.from("mobile_money_attempts").upsert(
      {
        tx_ref: payload.tx_ref,
        sale_id: payload.sale_id ?? null,
        organization_id: organizationId,
        gateway_provider: "dpo",
        payment_method: payload.payment_method ?? payload.network,
        network: payload.network,
        phone_number: payload.phone_number,
        amount: payload.amount,
        currency,
        status,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tx_ref" }
    );
  };

  await writeAttempt("initiated");

  const serviceTypeXml = serviceType
    ? `<ServiceType>${xmlEscape(serviceType)}</ServiceType>`
    : `<ServiceTypeName>${xmlEscape(serviceTypeName)}</ServiceTypeName>`;
  const createXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${xmlEscape(asMoney(payload.amount).toFixed(2))}</PaymentAmount>
    <PaymentCurrency>${xmlEscape(currency)}</PaymentCurrency>
    <CompanyRefUnique>1</CompanyRefUnique>
    <CompanyRef>${xmlEscape(payload.tx_ref)}</CompanyRef>
    <OrderNumber>${xmlEscape(payload.sale_id || payload.tx_ref)}</OrderNumber>
    <PTL>${xmlEscape(Deno.env.get("DPO_PTL_HOURS") || "1")}</PTL>
    <customerFirstName>${xmlEscape(first)}</customerFirstName>
    <customerLastName>${xmlEscape(last)}</customerLastName>
    <customerEmail>${xmlEscape(payload.customer_email || userData.user.email || "no-reply@boat.local")}</customerEmail>
    <DefaultPayment>MO</DefaultPayment>
    <DefaultPaymentCountry>${xmlEscape(country)}</DefaultPaymentCountry>
    <DefaultPaymentMNO>${xmlEscape(mno)}</DefaultPaymentMNO>
    <TransactionSource>Mobile</TransactionSource>
  </Transaction>
  <Services>
    <Service>
      ${serviceTypeXml}
      <ServiceDescription>${xmlEscape(serviceTypeName)}</ServiceDescription>
      <ServiceDate>${xmlEscape(serviceDate)}</ServiceDate>
    </Service>
  </Services>
</API3G>`;

  const createRes = await dpoPost(baseUrl, createXml);
  const createResult = textOf(createRes.doc, "Result");
  const createExplanation = textOf(createRes.doc, "ResultExplanation");
  const transactionToken = textOf(createRes.doc, "TransToken");
  const transactionRef = textOf(createRes.doc, "TransRef");

  if (createResult !== "000" || !transactionToken) {
    await writeAttempt("failed", {
      gateway_response: { stage: "createToken", xml: createRes.body },
      last_error: createExplanation || "DPO createToken failed",
    });
    return json({ ok: false, status: "failed", tx_ref: payload.tx_ref, message: createExplanation || "DPO createToken failed" }, 400);
  }

  await writeAttempt("pending", {
    dpo_transaction_token: transactionToken,
    gateway_transaction_ref: transactionRef || null,
    gateway_response: { stage: "createToken", xml: createRes.body },
    attempts: 1,
    last_error: null,
  });

  const chargeXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>ChargeTokenMobile</Request>
  <TransactionToken>${xmlEscape(transactionToken)}</TransactionToken>
  <PhoneNumber>${xmlEscape(phoneForDpo(payload.phone_number))}</PhoneNumber>
  <MNO>${xmlEscape(mno)}</MNO>
  <MNOcountry>${xmlEscape(country)}</MNOcountry>
</API3G>`;

  const chargeRes = await dpoPost(baseUrl, chargeXml);
  const chargeStatus = textOf(chargeRes.doc, "StatusCode") || textOf(chargeRes.doc, "Result") || textOf(chargeRes.doc, "Code");
  const chargeExplanation = textOf(chargeRes.doc, "ResultExplanation") || textOf(chargeRes.doc, "Explanation");
  if (chargeStatus && !["000", "130"].includes(chargeStatus)) {
    await writeAttempt("failed", {
      dpo_transaction_token: transactionToken,
      gateway_transaction_ref: transactionRef || null,
      gateway_response: { stage: "ChargeTokenMobile", xml: chargeRes.body },
      last_error: chargeExplanation || "DPO mobile charge failed",
    });
    return json({ ok: false, status: "failed", tx_ref: payload.tx_ref, message: chargeExplanation || "DPO mobile charge failed" }, 400);
  }

  await writeAttempt("pending", {
    dpo_transaction_token: transactionToken,
    gateway_transaction_ref: transactionRef || null,
    gateway_response: { stage: "ChargeTokenMobile", xml: chargeRes.body },
    last_error: null,
  });

  const deadline = Date.now() + timeoutSeconds * 1000;
  let verifyAttempts = 0;
  while (Date.now() < deadline) {
    await wait(5000);
    verifyAttempts += 1;
    const verifyXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${xmlEscape(transactionToken)}</TransactionToken>
  <CompanyRef>${xmlEscape(payload.tx_ref)}</CompanyRef>
</API3G>`;
    const verifyRes = await dpoPost(baseUrl, verifyXml);
    const result = textOf(verifyRes.doc, "Result");
    const explanation = textOf(verifyRes.doc, "ResultExplanation");
    const status = normalizeDpoStatus(result, explanation);

    if (status === "successful") {
      const returnedCurrency = (textOf(verifyRes.doc, "TransactionCurrency") || textOf(verifyRes.doc, "TransactionFinalCurrency") || currency).toUpperCase();
      const returnedAmount = asMoney(textOf(verifyRes.doc, "TransactionAmount") || textOf(verifyRes.doc, "TransactionFinalAmount"));
      if (returnedCurrency !== currency || returnedAmount !== asMoney(payload.amount)) {
        const message = returnedCurrency !== currency ? "DPO currency mismatch" : "DPO amount mismatch";
        await writeAttempt("failed", {
          dpo_transaction_token: transactionToken,
          gateway_transaction_ref: transactionRef || textOf(verifyRes.doc, "TransactionRef") || null,
          gateway_response: { stage: "verifyToken", xml: verifyRes.body },
          attempts: verifyAttempts,
          last_error: message,
        });
        return json({ ok: false, status: "failed", tx_ref: payload.tx_ref, message }, 400);
      }
      await writeAttempt("successful", {
        dpo_transaction_token: transactionToken,
        gateway_transaction_ref: transactionRef || textOf(verifyRes.doc, "TransactionRef") || null,
        gateway_response: { stage: "verifyToken", xml: verifyRes.body },
        attempts: verifyAttempts,
        paid_at: new Date().toISOString(),
        last_error: null,
      });
      return json({
        ok: true,
        status: "successful",
        transaction_id: transactionToken,
        tx_ref: payload.tx_ref,
        message: "Payment confirmed",
      });
    }

    if (status === "failed" || status === "cancelled") {
      await writeAttempt(status, {
        dpo_transaction_token: transactionToken,
        gateway_transaction_ref: transactionRef || null,
        gateway_response: { stage: "verifyToken", xml: verifyRes.body },
        attempts: verifyAttempts,
        last_error: explanation || "DPO payment failed",
      });
      return json({ ok: false, status, tx_ref: payload.tx_ref, message: explanation || "DPO payment failed" }, 400);
    }
  }

  await writeAttempt("timeout", {
    dpo_transaction_token: transactionToken,
    gateway_transaction_ref: transactionRef || null,
    attempts: verifyAttempts,
    last_error: "Payment timed out",
  });
  return json({
    ok: false,
    status: "timeout",
    transaction_id: transactionToken,
    tx_ref: payload.tx_ref,
    message: "Payment timed out",
  }, 408);
});
