export const assistantUsageSchema = `
  CREATE TABLE IF NOT EXISTS assistant_usage (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    model TEXT NOT NULL,
    token_reservation INTEGER NOT NULL,
    cost_reservation INTEGER NOT NULL,
    observed_input INTEGER,
    observed_output INTEGER,
    observed_cost INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS assistant_usage_account_day ON assistant_usage(account_id, day);
  PRAGMA user_version = 14;
`;

export function assistantUsageStore(db, now, transact, accountTokenLimit) {
  const usage = db.prepare(`
    SELECT COALESCE(SUM(MAX(token_reservation, COALESCE(observed_input + observed_output, 0))), 0) AS tokens,
      COALESCE(SUM(MAX(cost_reservation, COALESCE(observed_cost, 0))), 0) AS cost,
      COALESCE(SUM(observed_input + observed_output), 0) AS observedTokens,
      COALESCE(SUM(observed_cost), 0) AS observedCost
    FROM assistant_usage WHERE account_id = ? AND day = ?
  `);
  const insert = db.prepare(`
    INSERT INTO assistant_usage (account_id, day, model, token_reservation, cost_reservation)
    VALUES (?, ?, ?, ?, ?)
  `);
  const record = db.prepare(`
    UPDATE assistant_usage SET observed_input = ?, observed_output = ?, observed_cost = ?
    WHERE account_id = ? AND id = ?
  `);
  const day = () => new Date(now()).toISOString().slice(0, 10);
  return {
    today(account) {
      return usage.get(account, day());
    },
    reserve(account, model, estimate, limits) {
      return transact(db, () => {
        const currentDay = day();
        const current = usage.get(account, currentDay);
        if (current.tokens + estimate.tokens > Math.min(limits.tokens, accountTokenLimit(account)) || current.cost + estimate.cost > limits.cost) return undefined;
        return insert.run(account, currentDay, model, estimate.tokens, estimate.cost).lastInsertRowid;
      });
    },
    record(account, id, input, output, cost) {
      record.run(input, output, cost, account, id);
    },
  };
}
