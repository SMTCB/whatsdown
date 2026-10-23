import { MemoryStore } from "@/lib/db/memory-store";
import { runStoreContract } from "./store.contract";

runStoreContract("MemoryStore", () => new MemoryStore());
