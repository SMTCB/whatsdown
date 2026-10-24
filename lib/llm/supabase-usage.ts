import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelId } from "./pricing";
import { MODELS } from "./pricing";
import type { UsageLog, UsageRecord } from "./client";
import type { Task } from "./router";

interface Row {
  ticket_id: string;
  node: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | string;
}

/** Usage kept in the llm_usage table, so spend survives restarts and is shared by all server instances. */
export class SupabaseUsageLog implements UsageLog {
  constructor(private readonly db: SupabaseClient) {}

  async record(r: UsageRecord): Promise<void> {
    const { error } = await this.db.from("llm_usage").insert({
      ticket_id: r.ticketId,
      node: r.task,
      provider: MODELS[r.model].provider,
      model: r.model,
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_read_tokens: r.usage.cacheReadTokens ?? 0,
      cost_usd: r.costUsd,
    });
    if (error) throw new Error(`Could not record usage: ${error.message}`);
  }

  async totalFor(ticketId: string): Promise<number> {
    const { data, error } = await this.db.from("llm_usage").select("cost_usd").eq("ticket_id", ticketId);
    if (error) throw new Error(`Could not read usage: ${error.message}`);
    return (data ?? []).reduce((n, r) => n + Number(r.cost_usd), 0);
  }

  async all(): Promise<UsageRecord[]> {
    const { data, error } = await this.db
      .from("llm_usage")
      .select("ticket_id,node,model,input_tokens,output_tokens,cache_read_tokens,cost_usd")
      .not("ticket_id", "is", null)
      .limit(10000);
    if (error) throw new Error(`Could not read usage: ${error.message}`);
    return ((data ?? []) as Row[]).map((r) => ({
      ticketId: r.ticket_id,
      task: r.node as Task,
      model: r.model as ModelId,
      usage: { inputTokens: r.input_tokens, outputTokens: r.output_tokens, cacheReadTokens: r.cache_read_tokens },
      costUsd: Number(r.cost_usd),
    }));
  }
}
