import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../chatgpt-auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { isMaster } from "../../server/vitrine.mjs";
import { hasMasterSession } from "../../server/master-auth.mjs";
import { Dashboard } from "../ui/Dashboard.jsx";
export const dynamic = "force-dynamic";
export const metadata = { title: "Painel Adimin | Vitrine" };
export default async function AdminPage() {
  const user = await getChatGPTUser();
  const master = isMaster(user, env, import.meta.env.DEV);
  const masterAuthenticated = master && await hasMasterSession((await headers()).get("cookie"), env, user, import.meta.env.DEV);
  return <Dashboard mode="admin" name={user?.displayName} master={master} masterAuthenticated={masterAuthenticated}
    signIn={chatGPTSignInPath("/admin")} signOut={chatGPTSignOutPath("/")}/>;
}
