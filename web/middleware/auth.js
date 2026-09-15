export default defineNuxtRouteMiddleware(async (to, from) => {
  const nuxtApp = useNuxtApp();
  // if (import.meta.server) {
  //   const refreshToken = useCookie("geodashboard_refresh_token");

  //   if (!refreshToken.value) {
  //     const shareId = to.query.share_id;
  //     if (shareId) {
  //       return navigateTo({
  //         path: "/",
  //         query: { share_id: shareId },
  //       });
  //     } else {
  //       return navigateTo("/");
  //     }
  //   }
  // }

  if (import.meta.client) {
    const authStore = useAuth(nuxtApp.$pinia);
    if (!authStore.appLoad && !authStore.isSignedIn) {
      return navigateTo("/");
    }
  }
});
