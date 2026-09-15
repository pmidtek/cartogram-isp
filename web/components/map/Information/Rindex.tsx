import { defineComponent as createElement } from "vue";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
import MapMarkdownRenderer from "~/components/map/MarkdownRenderer.vue";
import MapAttachmentLink from "~/components/map/AttachmentLink.vue";
import { useQuery } from "@tanstack/vue-query";

export default createElement({
  setup() {
    const {
      data: mapData,
      error: mapError,
      isFetching: isMapFetching,
      isError: isMapError,
    } = useQuery({
      queryKey: [`/panel/items/map/eng`],
      queryFn: ({ queryKey }) =>
        $fetch<MapData>(queryKey[0]).then((r) => r.data),
    });

    const featureStore = useFeature();

    return {
      isLoading: isMapFetching,
      data: mapData,
      featureStore,
    };
  },

  render() {
    return (
      <div>
        <div class='flex justify-between items-center m-3'>
          <h2 class='text-white'>Map Information</h2>
          <IcArrowLeft
            // @ts-ignore
            role='button'
            onClick={() => this.featureStore.setRightSidebar("")}
            fontControlled={false}
            class='w-3 h-3 rotate-180 text-grey-50'
          />
        </div>
        <hr class='mx-3' />
        <div class='flex-1 overflow-scroll px-3 my-3'>
          {this.isLoading ? (
            <div class='animate-pulse space-y-3'>
              <div class='w-full h-8 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-8 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-44 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-4 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-4 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-4 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-4 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-4 bg-grey-700 rounded-xs'></div>
              <div class='w-full h-4 bg-grey-700 rounded-xs'></div>
            </div>
          ) : (
            <MapMarkdownRenderer source={this.data?.information} />
          )}
          {this.data?.information_attachments?.length ? (
            <ul class='mt-3 space-y-3'>
              {this.data.information_attachments.map((attachment) => (
                <MapAttachmentLink
                  title={attachment.title}
                  description={attachment.description}
                  url={attachment.url}
                  icon={attachment.icon}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  },
});
