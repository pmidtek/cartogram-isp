import { defineStore } from "pinia";

// Watches the geoprocessing queue for FTTH analysis (generate-network) tasks and
// notifies once one finishes. Runs on a global poll so it works even when the
// geoprocessing queue panel is closed (that panel's component unmounts on close).
export const useFtthAnalysisWatcher = defineStore("ftthAnalysisWatcher", () => {
  const authStore = useAuth();
  const featureStore = useFeature();
  const toast = useToast();

  const FTTH_ANALYSIS_ACTOR = "generate_network";
  const POLL_MS = 10 * 1000;

  const showDoneModal = ref(false);
  const doneProjectName = ref("");

  // message_ids of FTTH tasks seen in-flight (queued/consumed) this session
  const inFlight = new Set<string>();
  // message_ids already notified, to avoid duplicate modals
  const notified = new Set<string>();

  let timer: ReturnType<typeof setInterval> | null = null;
  let consumers = 0;

  const authHeaders = () => ({
    Authorization: "Bearer " + authStore.accessToken,
  });

  const fetchProjectName = async (projectId?: number) => {
    if (!projectId) return "";
    try {
      const r = await $fetch<{ data: { name: string } }>(
        `/panel/items/project_map/${projectId}?fields=name`,
        { headers: authHeaders() },
      );
      return r.data?.name ?? "";
    } catch {
      return "";
    }
  };

  const handleDone = async (id: string) => {
    if (notified.has(id)) return;
    try {
      const r = await $fetch<{
        data: {
          state: string;
          status: string;
          message?: any;
          result?: Record<string, any>;
        };
      }>(
        `/panel/items/geoprocessing_queue/${id}?` +
          new URLSearchParams({
            fields: "message_id,state,status,message,result",
          }),
        { headers: authHeaders() },
      );

      // Ignore tasks that are not finished yet
      if (!["done", "rejected"].includes(r.data.state)) return;

      notified.add(id);

      if (r.data.state === "done" && r.data.status === "success") {
        doneProjectName.value = await fetchProjectName(
          r.data.message?.kwargs?.project_id,
        );
        showDoneModal.value = true;
        featureStore.isShowProject = true;
      } else {
        toast.add({
          title: "FTTH Analysis Failed",
          description:
            r.data.result?.error ||
            "An unexpected error occurred while generating the FTTH network.",
          icon: "i-heroicons-x-circle",
          ui: {
            background: "bg-white",
            title: "text-gray-900 text-md font-semibold",
            description: "text-gray-500",
            icon: "text-red-500",
          },
        });
      }
    } catch (error) {
      console.error("FTTH watcher: failed to confirm completion", error);
    }
  };

  const poll = async () => {
    try {
      const r = await $fetch<{ data: any[] }>(
        "/panel/items/geoprocessing_queue?" +
          new URLSearchParams({
            limit: "50",
            fields: "message_id,state,status,message",
            filter: JSON.stringify({
              _or: [
                { state: { _eq: "consumed" } },
                { state: { _eq: "queued" } },
              ],
            }),
          }),
        { headers: authHeaders() },
      );

      const currentIds = new Set<string>();
      for (const item of r.data) {
        if (item.message?.actor_name === FTTH_ANALYSIS_ACTOR) {
          currentIds.add(item.message_id);
          inFlight.add(item.message_id);
        }
      }

      // A task that was in-flight and is no longer in the queue has finished
      for (const id of [...inFlight]) {
        if (!currentIds.has(id)) {
          inFlight.delete(id);
          await handleDone(id);
        }
      }
    } catch (error) {
      console.error("FTTH watcher poll failed", error);
    }
  };

  const start = () => {
    consumers += 1;
    if (timer) return;
    poll();
    timer = setInterval(poll, POLL_MS);
  };

  const stop = () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { showDoneModal, doneProjectName, start, stop };
});
