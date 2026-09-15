import { defineStore } from "pinia";
import { useQueryClient } from "@tanstack/vue-query";
export const useGeoprocessingQueue = defineStore("geoprocessingQueue", () => {
  const authStore = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const checkQueueState = async (id: string) => {
    try {
      const response = await fetch(
        `/panel/items/geoprocessing_queue/${id}?` +
          new URLSearchParams({
            fields: "message_id,state,status,message",
          }),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        }
      );
      const result = await response.json();
      if (result.errors?.length) throw new Error(result.errors[0].message);
      if (["done", "rejected"].includes(result.data.state)) {
        if (result.data.state === "rejected") {
          toast.add({
            title: `Your ${result.data.message.actor_name} task has been rejected. Please review and try again.`,
            icon: "i-heroicons-x-mark",
            ui: {
              background: "bg-white",
              title: "text-gray-900 text-md font-semibold",
              description: "text-gray-500",
              icon: "text-blue-500",
            },
          });
        } else {
          if (result.data.status === "success") {
            toast.add({
              title: `Your ${result.data.message.actor_name} task has been successfully processed!`,
              icon: "i-heroicons-check-circle",
              ui: {
                background: "bg-white",
                title: "text-gray-900 text-md font-semibold",
                description: "text-gray-500",
                icon: "text-blue-500",
              },
            });
          } else if (result.data.status === "error") {
            toast.add({
              title: `There was an error processing your ${result.data.message.actor_name} task. Please try again.`,
              icon: "i-heroicons-x-mark",
              ui: {
                background: "bg-white",
                title: "text-gray-900 text-md font-semibold",
                description: "text-gray-500",
                icon: "text-blue-500",
              },
            });
          }
        }
      } else {
        toast.add({
          title: "Success",
          description:
            "Your intersect task has been successfully added to the queue! You'll be notified once processing is complete.",
          icon: "i-heroicons-check-circle",
          ui: {
            background: "bg-white",
            title: "text-gray-900 text-md font-semibold",
            description: "text-gray-500",
            icon: "text-blue-500",
          },
        });
      }
      queryClient.refetchQueries({
        queryKey: ["geoprocessing_queue_query_key"],
        type: "active",
        exact: true,
      });
      queryClient.refetchQueries({
        queryKey: ["geoprocessing_history_query_key"],
        type: "active",
        exact: true,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get queue result. Please try again.";
      toast.add({
        title: message,
        icon: "i-heroicons-x-mark",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    }
  };
  return { checkQueueState };
});
