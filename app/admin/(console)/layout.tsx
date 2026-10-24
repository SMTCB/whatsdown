import { Shell } from "@/components/shell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <Shell admin>{children}</Shell>;
}
