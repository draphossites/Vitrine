import { demoProducts, demoStore } from "./demo.mjs";
import {
  clearMasterCookie, createMasterCookie, hasMasterSession, masterLoginConfigured, verifyMasterPassword,
} from "./master-auth.mjs";
import {
  RequestError, cents, hexColor, httpsUrl, imageUrl, insist, option, orderRecord, orderStatuses,
  paymentLabels, paymentRecord, phoneNumber, pickFields, productRecord, shortText, storeRecord,
  subscriptionStatuses, validSlug, whatsappLink,
} from "./model.mjs";

const mediaTypes = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif" };
const stamp = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const json = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function dbQuery(db, sql, ...params) {
  return db.prepare(sql).bind(...params);
}

function insert(db, table, values) {
  const keys = Object.keys(values);
  return dbQuery(db, "INSERT INTO " + table + " (" + keys.join(",") + ") VALUES (" +
    keys.map(() => "?").join(",") + ")", ...Object.values(values));
}

function update(db, table, values, scope, ...params) {
  const columns = Object.keys(values).map((column) => column + " = ?");
  return dbQuery(db, "UPDATE " + table + " SET " + columns.join(", ") + " WHERE " + scope,
    ...Object.values(values), ...params);
}

async function rows(db, sql, ...params) {
  return (await dbQuery(db, sql, ...params).all()).results;
}

async function bodyJson(request) {
  insist(request.headers.get("content-type")?.startsWith("application/json"), "Formato de dados inválido.", 415);
  const payload = await request.text();
  insist(payload.length <= 32000, "O formulário excedeu o limite de tamanho.", 413);
  let body;
  try { body = JSON.parse(payload); } catch { throw new RequestError(400, "Dados do formulário inválidos."); }
  insist(body && typeof body === "object" && !Array.isArray(body), "Dados do formulário inválidos.");
  return body;
}

async function masterLoginRoute(request, path, env, identity, localPreview) {
  insist(isMaster(identity, env, localPreview), "Esta área exige acesso ao painel Adimin.", 403);
  insist(request.method === "POST" && path.length === 2, "Esta opção não está disponível.", 404);
  let sessionCookie;
  if (path[1] === "logout") {
    sessionCookie = clearMasterCookie(localPreview);
  } else if (path[1] === "login") {
    insist(masterLoginConfigured(env), "O login do painel Adimin ainda não está configurado.", 503);
    const { email, password } = await bodyJson(request);
    insist(await verifyMasterPassword(env, email, password), "E-mail ou senha incorretos.", 401);
    sessionCookie = await createMasterCookie(env, identity, localPreview);
  } else {
    throw new RequestError(404, "Esta opção não está disponível.");
  }
  const response = json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie);
  return response;
}

export function isMaster(identity, env, localPreview = false) {
  return Boolean(identity && (
    (env.VITRINE_MASTER_EMAIL && identity.email.toLowerCase() === env.VITRINE_MASTER_EMAIL.trim().toLowerCase()) ||
    (localPreview && identity.userId === "local_seedy")
  ));
}

async function syncUser(db, identity) {
  await dbQuery(db, "INSERT INTO users (id,name,email,created_at) VALUES (?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email",
    identity.userId, identity.displayName, identity.email, stamp()).run();
}

const productFields = {
  name: (value) => ["name", shortText(value, "Nome do produto", 110, true)],
  description: (value) => ["description", shortText(value, "Descrição", 800)],
  priceCents: (value) => ["price_cents", cents(value, "Preço", 1)],
  imageUrl: (value) => ["image_url", imageUrl(value)],
  category: (value) => ["category", shortText(value, "Categoria", 60)],
  available: (value) => ["available", value ? 1 : 0],
};

const storeFields = {
  name: (value) => ["name", shortText(value, "Nome da loja", 100, true)],
  description: (value) => ["description", shortText(value, "Descrição", 360)],
  whatsapp: (value) => ["whatsapp", phoneNumber(value)],
  logoUrl: (value) => ["logo_url", imageUrl(value)],
  bannerUrl: (value) => ["banner_url", imageUrl(value)],
  primaryColor: (value) => ["primary_color", hexColor(value, "Cor principal")],
  backgroundColor: (value) => ["background_color", hexColor(value, "Cor de fundo")],
  font: (value) => ["font", option(value, ["system", "sans", "serif", "mono"], "Fonte")],
  deliveryEnabled: (value) => ["delivery_enabled", value ? 1 : 0],
  deliveryFeeCents: (value) => ["delivery_fee_cents", cents(value, "Taxa de entrega")],
  paymentMethods: (value) => {
    insist(Array.isArray(value) && value.length > 0 && value.every((method) => Object.hasOwn(paymentLabels, method)), "Selecione ao menos uma forma de pagamento válida.");
    return ["payment_methods", JSON.stringify([...new Set(value)])];
  },
};

async function merchantRoute(request, path, db, env, identity) {
  const [, resource, id] = path;
  const method = request.method;
  if (method === "GET" || (resource === "store" && method === "POST")) await syncUser(db, identity);
  const store = await dbQuery(db, "SELECT * FROM stores WHERE owner_id = ?", identity.userId).first();
  if (!resource && method === "GET") {
    if (!store) return json({ store: null, products: [], orders: [], payments: [] });
    const lists = await db.batch([
      dbQuery(db, "SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC", store.id),
      dbQuery(db, "SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC LIMIT 200", store.id),
      dbQuery(db, "SELECT * FROM payments WHERE store_id = ? ORDER BY created_at DESC LIMIT 200", store.id),
    ]);
    return json({ store: storeRecord(store, true), products: lists[0].results.map(productRecord),
      orders: lists[1].results.map(orderRecord), payments: lists[2].results.map(paymentRecord) });
  }
  if (resource === "store" && method === "POST") {
    insist(!store, "Sua conta já tem uma loja.", 409);
    const body = await bodyJson(request);
    insist(validSlug(body.slug) && body.slug !== demoStore.slug, "Use um endereço de 3 a 55 caracteres, com letras minúsculas, números e hífens.");
    const values = { id: uuid(), owner_id: identity.userId, slug: body.slug, created_at: stamp(),
      name: shortText(body.name, "Nome da loja", 100, true), whatsapp: phoneNumber(body.whatsapp),
      description: shortText(body.description, "Descrição", 360) };
    try {
      await insert(db, "stores", values).run();
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new RequestError(409, "O endereço já está em uso ou sua conta já tem uma loja.");
      throw error;
    }
    return json({ ok: true }, 201);
  }
  insist(store, "Crie sua loja para continuar.", 404);
  if (resource === "store" && method === "PATCH") {
    const values = pickFields(await bodyJson(request), storeFields);
    insist(Object.keys(values).length, "Nenhuma configuração para salvar.");
    await update(db, "stores", values, "id = ?", store.id).run();
    return json({ ok: true });
  }
  if (resource === "products" && method === "POST" && !id) {
    const body = await bodyJson(request);
    const values = pickFields(body, productFields);
    insist(values.name && values.price_cents, "Informe o nome e o preço do produto.");
    await insert(db, "products", { ...values, id: uuid(), store_id: store.id, created_at: stamp() }).run();
    return json({ ok: true }, 201);
  }
  if (resource === "products" && id && method === "PATCH") {
    const values = pickFields(await bodyJson(request), productFields);
    insist(Object.keys(values).length, "Nenhuma alteração para salvar.");
    const result = await update(db, "products", values, "id = ? AND store_id = ?", id, store.id).run();
    insist(result.meta.changes, "Produto não encontrado.", 404);
    return json({ ok: true });
  }
  if (resource === "products" && id && method === "DELETE") {
    const result = await dbQuery(db, "DELETE FROM products WHERE id = ? AND store_id = ?", id, store.id).run();
    insist(result.meta.changes, "Produto não encontrado.", 404);
    return json({ ok: true });
  }
  if (resource === "orders" && id && method === "PATCH") {
    const { status } = await bodyJson(request);
    option(status, orderStatuses, "Situação do pedido");
    const result = await update(db, "orders", { status }, "id = ? AND store_id = ?", id, store.id).run();
    insist(result.meta.changes, "Pedido não encontrado.", 404);
    return json({ ok: true });
  }
  if (resource === "payments" && method === "POST") {
    const body = await bodyJson(request);
    const reference = shortText(body.reference, "Referência do pagamento", 150, true);
    const receipt = httpsUrl(body.receiptUrl, "Link do comprovante");
    const result = await dbQuery(db, "INSERT INTO payments (id,store_id,reference,receipt_url,created_at) " +
      "SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM payments WHERE store_id = ? AND status = 'pending')",
      uuid(), store.id, reference, receipt, stamp(), store.id).run();
    insist(result.meta.changes, "Já existe um pagamento aguardando aprovação.", 409);
    return json({ ok: true }, 201);
  }
  if (resource === "upload" && method === "POST") {
    insist(env.BUCKET, "O armazenamento de imagens está indisponível.", 503);
    insist(Number(request.headers.get("content-length") || 0) <= 4200000, "A imagem deve ter até 4 MB.", 413);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    insist(file && typeof file !== "string" && Object.hasOwn(mediaTypes, file.type) && file.size > 0, "Escolha uma imagem PNG, JPEG, WebP ou AVIF.");
    insist(file.size <= 4000000, "A imagem deve ter até 4 MB.", 413);
    const extension = mediaTypes[file.type];
    const key = uuid() + "." + extension;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return json({ url: "/api/vitrine/media/" + key }, 201);
  }
  throw new RequestError(404, "Esta opção não está disponível.");
}

async function adminRoute(request, path, db, env, identity, localPreview) {
  insist(isMaster(identity, env, localPreview), "Esta área exige acesso ao painel Adimin.", 403);
  const [, resource, id] = path;
  if (!resource && request.method === "GET") {
    await syncUser(db, identity);
    const all = await db.batch([
      dbQuery(db, "SELECT s.*, u.name AS owner_name, u.email AS owner_email FROM stores s JOIN users u ON s.owner_id = u.id ORDER BY s.created_at DESC"),
      dbQuery(db, "SELECT * FROM users ORDER BY created_at DESC"),
      dbQuery(db, "SELECT p.*, s.name AS store_name FROM payments p JOIN stores s ON p.store_id = s.id ORDER BY p.status != 'pending', p.created_at DESC"),
      dbQuery(db, "SELECT * FROM history ORDER BY created_at DESC LIMIT 200"),
    ]);
    return json({
      stores: all[0].results.map((row) => storeRecord(row, true)),
      users: all[1].results.map((row) => ({ id: row.id, name: row.name, email: row.email, createdAt: row.created_at,
        role: isMaster({ userId: row.id, email: row.email }, env, localPreview) ? "master" : "merchant" })),
      payments: all[2].results.map(paymentRecord),
      history: all[3].results.map((row) => ({ id: row.id, description: row.description, actorName: row.actor_name, createdAt: row.created_at })),
    });
  }
  insist(request.method === "PATCH" && id, "Esta opção não está disponível.", 404);
  const body = await bodyJson(request);
  const time = stamp();
  const log = (description) => insert(db, "history", { id: uuid(), actor_name: identity.displayName, description, created_at: time });
  if (resource === "stores" || resource === "subscriptions") {
    const store = await dbQuery(db, "SELECT id,name FROM stores WHERE id = ?", id).first();
    insist(store, "Loja não encontrada.", 404);
    if (resource === "stores") {
      const status = option(body.status, ["active", "blocked"], "Situação da loja");
      await db.batch([update(db, "stores", { status }, "id = ?", id), log(
        (status === "active" ? "Loja desbloqueada: " : "Loja bloqueada: ") + store.name)]);
    } else {
      const status = option(body.subscriptionStatus, subscriptionStatuses, "Situação da assinatura");
      let expiry = null;
      if (body.subscriptionExpiresAt != null && body.subscriptionExpiresAt !== "") {
        const time = Date.parse(body.subscriptionExpiresAt);
        insist(Number.isFinite(time), "Informe uma data de vencimento válida.");
        expiry = new Date(time).toISOString();
      }
      await db.batch([update(db, "stores", { subscription_status: status, subscription_expires_at: expiry }, "id = ?", id),
        log("Assinatura atualizada: " + store.name)]);
    }
    return json({ ok: true });
  }
  if (resource === "payments") {
    const status = option(body.status, ["approved", "rejected"], "Situação do pagamento");
    const payment = await dbQuery(db, "SELECT p.store_id, s.name FROM payments p JOIN stores s ON s.id = p.store_id WHERE p.id = ?", id).first();
    insist(payment, "Pagamento não encontrado.", 404);
    const reviewKey = uuid();
    const queries = [update(db, "payments", { status, review_key: reviewKey }, "id = ? AND status = 'pending'", id)];
    const applied = "EXISTS (SELECT 1 FROM payments WHERE id = ? AND review_key = ?)";
    if (status === "approved") {
      queries.push(dbQuery(db, "UPDATE stores SET subscription_status = 'active', " +
        "subscription_expires_at = CASE WHEN subscription_expires_at <= ? THEN NULL ELSE subscription_expires_at END WHERE id = ? AND " + applied,
        time, payment.store_id, id, reviewKey));
    }
    queries.push(dbQuery(db, "INSERT INTO history (id,actor_name,description,created_at) SELECT ?,?,?,? WHERE " + applied,
      uuid(), identity.displayName, (status === "approved" ? "Pagamento aprovado: " : "Pagamento recusado: ") + payment.name,
      time, id, reviewKey));
    const [result] = await db.batch(queries);
    insist(result.meta.changes, "Este pagamento já foi revisado.", 409);
    return json({ ok: true });
  }
  throw new RequestError(404, "Esta opção não está disponível.");
}

function validOrder(body, store, records) {
  insist(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 30, "Adicione de 1 a 30 produtos.");
  const customerName = shortText(body.customerName, "Seu nome", 90, true);
  const fulfillment = option(body.fulfillment, ["pickup", "delivery"], "Entrega");
  insist(fulfillment === "pickup" || store.deliveryEnabled, "Esta loja oferece apenas retirada.");
  const address = fulfillment === "delivery" ? shortText(body.address, "Endereço", 220, true) : "";
  const paymentMethod = option(body.paymentMethod, store.paymentMethods, "Forma de pagamento");
  const notes = shortText(body.notes, "Observações", 400);
  const catalog = new Map(records.map((product) => [product.id, product]));
  const used = new Set();
  const items = body.items.map((line) => {
    const product = catalog.get(line?.productId);
    insist(product?.available && !used.has(product.id), "Um dos itens não está mais disponível. Atualize o carrinho.", 409);
    insist(Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 20, "A quantidade deve ser de 1 a 20 por produto.");
    used.add(product.id);
    return { productId: product.id, name: product.name, quantity: line.quantity, priceCents: product.priceCents };
  });
  const deliveryFeeCents = fulfillment === "delivery" ? store.deliveryFeeCents : 0;
  const totalCents = items.reduce((total, line) => total + line.priceCents * line.quantity, deliveryFeeCents);
  return { id: uuid(), customerName, fulfillment, address, paymentMethod, notes, items, totalCents, deliveryFeeCents, status: "open", createdAt: stamp() };
}

async function publicRoute(request, path, db) {
  const [, slug, resource] = path;
  insist(validSlug(slug), "Loja não encontrada.", 404);
  if (slug === demoStore.slug) {
    if (request.method === "GET" && !resource) return json({ store: demoStore, products: demoProducts });
    if (request.method === "POST" && resource === "orders") return json({
      order: validOrder(await bodyJson(request), demoStore, demoProducts), whatsappUrl: null,
    });
  }
  const row = await dbQuery(db, "SELECT * FROM stores WHERE slug = ? AND status = 'active'", slug).first();
  insist(row, "Loja não encontrada ou temporariamente indisponível.", 404);
  if (request.method === "GET" && !resource) {
    const products = await rows(db, "SELECT * FROM products WHERE store_id = ? AND available = 1 ORDER BY created_at DESC", row.id);
    return json({ store: storeRecord(row), products: products.map(productRecord) });
  }
  if (request.method === "POST" && resource === "orders") {
    const body = await bodyJson(request);
    const requestId = body.requestId ?? uuid();
    insist(typeof requestId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId), "O identificador do pedido é inválido.");
    const store = storeRecord(row, true);
    const previous = await dbQuery(db, "SELECT * FROM orders WHERE store_id = ? AND request_id = ?", row.id, requestId).first();
    if (previous) {
      const order = orderRecord(previous);
      return json({ order, whatsappUrl: whatsappLink(store, order) });
    }
    insist(Array.isArray(body.items) && body.items.length >= 1 && body.items.length <= 30, "Adicione de 1 a 30 produtos.");
    const ids = body.items.map((line) => shortText(line?.productId, "Produto", 80, true));
    const products = await rows(db, "SELECT * FROM products WHERE store_id = ? AND available = 1 AND id IN (" +
      ids.map(() => "?").join(",") + ")", row.id, ...ids);
    const order = validOrder(body, store, products.map(productRecord));
    await dbQuery(db, "INSERT INTO orders (id,store_id,request_id,customer_name,fulfillment,address,payment_method,notes,items,total_cents,delivery_fee_cents,created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(store_id,request_id) DO NOTHING", order.id, row.id, requestId,
      order.customerName, order.fulfillment, order.address, order.paymentMethod, order.notes, JSON.stringify(order.items),
      order.totalCents, order.deliveryFeeCents, order.createdAt).run();
    const saved = orderRecord(await dbQuery(db, "SELECT * FROM orders WHERE store_id = ? AND request_id = ?", row.id, requestId).first());
    return json({ order: saved, whatsappUrl: whatsappLink(store, saved) }, 201);
  }
  throw new RequestError(404, "Esta opção não está disponível.");
}

export async function handleVitrine(request, path, env, identity, localPreview = false) {
  try {
    const method = request.method;
    const origin = request.headers.get("origin");
    if (method !== "GET" && origin) insist(origin === new URL(request.url).origin, "Origem da solicitação inválida.", 403);
    if (path[0] === "session" && method === "GET") {
      return json({ user: identity ? { name: identity.displayName, email: identity.email, isMaster: isMaster(identity, env, localPreview) } : null });
    }
    if (path[0] === "media" && method === "GET") {
      const key = path[1];
      insist(/^[a-f0-9-]+\.(?:png|jpg|webp|avif)$/.test(key || ""), "Imagem não encontrada.", 404);
      const object = await env.BUCKET?.get(key);
      insist(object, "Imagem não encontrada.", 404);
      const headers = new Headers({ "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" });
      object.writeHttpMetadata(headers);
      return new Response(object.body, { headers });
    }
    if (path[0] === "public" && path[1] === demoStore.slug) return await publicRoute(request, path, env.DB);
    insist(path[0] === "public" || identity, "Entre na sua conta para continuar.", 401);
    if (path[0] === "master") return await masterLoginRoute(request, path, env, identity, localPreview);
    insist(env.DB, "O banco de dados está indisponível. Atualize a página para tentar novamente.", 503);
    if (path[0] === "public") return await publicRoute(request, path, env.DB);
    if (path[0] === "merchant") return await merchantRoute(request, path, env.DB, env, identity);
    if (path[0] === "admin") {
      insist(isMaster(identity, env, localPreview), "Esta área exige acesso ao painel Adimin.", 403);
      const session = await hasMasterSession(request.headers.get("cookie"), env, identity, localPreview);
      insist(session, "Entre no painel Adimin com seu e-mail e senha.", 401);
      return await adminRoute(request, path, env.DB, env, identity, localPreview);
    }
    throw new RequestError(404, "Esta opção não está disponível.");
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("Falha na Vitrine:", error instanceof Error ? error.message : "erro inesperado");
    return json({ error: "Ocorreu um erro ao processar a solicitação. Tente novamente." }, 500);
  }
}
