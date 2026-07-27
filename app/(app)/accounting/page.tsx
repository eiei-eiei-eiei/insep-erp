import { getBootstrap } from "./data";
import { AccountingApp } from "./_components/AccountingApp";
import type { Bootstrap } from "./_components/types";

export default async function AccountingPage() {
  const boot = (await getBootstrap()) as Bootstrap;
  return <AccountingApp boot={boot} />;
}
