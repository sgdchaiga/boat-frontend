import { useEffect, useState } from "react";
import { readOfflineRetailQueue } from "../../../lib/retailOfflineQueue";

export function useOfflineQueue() {
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  useEffect(() => {
    setOfflineQueueCount(readOfflineRetailQueue().length);
  }, []);

  const refreshOfflineQueueCount = () => {
    setOfflineQueueCount(readOfflineRetailQueue().length);
  };

  return {
    syncingOfflineQueue,
    setSyncingOfflineQueue,
    offlineQueueCount,
    setOfflineQueueCount,
    refreshOfflineQueueCount,
  };
}
