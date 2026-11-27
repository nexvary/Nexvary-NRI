const windowMs = 60_000;
const maxAttempts = 12;
const capacity = 4096;

export function createLoginThrottle(now = Date.now) {
  const addresses = new Map();
  const accounts = new Map();
  let cleanup = 0;
  let concurrent = 0;
  return {
    begin(address, email) {
      const at = now();
      if (at >= cleanup) {
        for (const entries of [addresses,accounts]) {
          for (const [key,item] of entries) if (item.until <= at) entries.delete(key);
        }
        cleanup = at + windowMs;
      }
      const keys = [[addresses,address], ...(email ? [[accounts,email]] : [])];
      const buckets = keys.map(([entries,key]) => {
        const current = entries.get(key);
        return current?.until > at ? current : { until:at + windowMs,count:0 };
      });
      const blocked = buckets.find((item,index) => item.count >= maxAttempts ||
        (!keys[index][0].has(keys[index][1]) && keys[index][0].size >= capacity));
      if (blocked) return Math.max(1,Math.ceil((blocked.until-at)/1000));
      if (concurrent >= 2) return 1;
      keys.forEach(([entries,key],index) => {
        buckets[index].count++;
        entries.set(key,buckets[index]);
      });
      concurrent++;
      return 0;
    },
    finish() { concurrent--; },
  };
}
