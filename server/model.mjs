export const paymentLabels = { pix: "Pix", card: "Cartão", cash: "Dinheiro" };
export const orderStatuses = ["open", "confirmed", "completed", "cancelled"];
export const subscriptionStatuses = ["pending", "active", "expired"];
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function insist(condition, message, status = 400) {
  if (!condition) throw new RequestError(status, message);
}

export function shortText(value, label, limit, required = false) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  insist(cleaned.length <= limit, `${label} deve ter até ${limit} caracteres.`);
  insist(!required || cleaned, `Preencha ${label.toLowerCase()}.`);
  return cleaned;
}

export function cents(value, label, minimum = 0) {
  insist(Number.isSafeInteger(value) && value >= minimum && value <= 10000000, `Informe um valor válido em ${label.toLowerCase()}.`);
  return value;
}

export function option(value, values, label) {
  insist(values.includes(value), `Selecione uma opção válida em ${label.toLowerCase()}.`);
  return value;
}

export function imageUrl(value) {
  const result = shortText(value, "URL da imagem", 2048);
  if (/^\/api\/vitrine\/media\/[a-f0-9-]+\.(?:png|jpg|webp|avif)$/i.test(result)) return result;
  return httpsUrl(result, "URL da imagem");
}

export function httpsUrl(value, label) {
  const result = shortText(value, label, 2048);
  if (!result) return "";
  try {
    const parsed = new URL(result);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.href;
  } catch {}
  throw new RequestError(400, `${label} precisa começar com https://.`);
}

export function phoneNumber(value) {
  const digits = shortText(value, "WhatsApp", 35, true).replace(/\D/g, "");
  if (/^[1-9]\d{9,10}$/.test(digits)) return "55" + digits;
  insist(/^55[1-9]\d{9,10}$/.test(digits), "Informe o WhatsApp com DDD e 10 ou 11 dígitos.");
  return digits;
}

export function validSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 3 && value.length <= 55;
}

export function hexColor(value, label) {
  insist(typeof value === "string" && /^#[\da-f]{6}$/i.test(value), `Selecione uma cor válida em ${label.toLowerCase()}.`);
  return value;
}

export function pickFields(body, parsers) {
  return Object.fromEntries(
    Object.entries(parsers).filter(([name]) => Object.hasOwn(body, name))
      .map(([name, parser]) => parser(body[name]))
  );
}

export function subscriptionStatus(row) {
  if (row.subscription_status === "active" && row.subscription_expires_at && row.subscription_expires_at <= new Date().toISOString()) return "expired";
  return row.subscription_status;
}

export function storeRecord(row, includePrivate = false) {
  if (!row) return null;
  const record = {
    name: row.name, slug: row.slug, description: row.description, logoUrl: row.logo_url, bannerUrl: row.banner_url,
    primaryColor: row.primary_color, backgroundColor: row.background_color, font: row.font,
    deliveryEnabled: Boolean(row.delivery_enabled), deliveryFeeCents: row.delivery_fee_cents,
    paymentMethods: JSON.parse(row.payment_methods), status: row.status, isDemo: false,
  };
  if (includePrivate) Object.assign(record, {
    id: row.id, whatsapp: row.whatsapp, subscriptionStatus: subscriptionStatus(row),
    subscriptionExpiresAt: row.subscription_expires_at, createdAt: row.created_at,
    ownerName: row.owner_name, ownerEmail: row.owner_email,
  });
  return record;
}

export function productRecord(row) {
  return {
    id: row.id, name: row.name, description: row.description, priceCents: row.price_cents,
    imageUrl: row.image_url, category: row.category, available: Boolean(row.available),
  };
}

export function orderRecord(row) {
  return {
    id: row.id, customerName: row.customer_name, totalCents: row.total_cents, createdAt: row.created_at,
    status: row.status, fulfillment: row.fulfillment, address: row.address, paymentMethod: row.payment_method,
    notes: row.notes, items: JSON.parse(row.items), deliveryFeeCents: row.delivery_fee_cents,
  };
}

export function paymentRecord(row) {
  return {
    id: row.id, storeId: row.store_id, storeName: row.store_name, reference: row.reference, receiptUrl: row.receipt_url,
    status: row.status, createdAt: row.created_at,
  };
}

export function whatsappLink(store, order) {
  if (!store.whatsapp) return null;
  const message = [
    `Olá! Quero fazer este pedido na ${store.name}.`,
    "",
    ...order.items.map((item) => `${item.quantity} × ${item.name} — ${moneyFormat.format(item.priceCents * item.quantity / 100)}`),
    "",
    order.fulfillment === "delivery"
      ? `Entrega — ${moneyFormat.format(order.deliveryFeeCents / 100)}\nEndereço: ${order.address}`
      : "Retirada na loja",
    `Total: ${moneyFormat.format(order.totalCents / 100)}`,
    `Pagamento: ${paymentLabels[order.paymentMethod]}`,
    `Cliente: ${order.customerName}`,
    order.notes ? `Observações: ${order.notes}` : "",
    `Pedido: ${order.id.slice(0, 8).toUpperCase()}`,
  ].filter((line, index) => line || index === 1).join("\n");
  return `https://wa.me/${store.whatsapp}?text=${encodeURIComponent(message)}`;
}
