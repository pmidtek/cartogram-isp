import { defineStore } from "pinia";
import { expiresTokenKey } from "~/constants";

export const useAuth = defineStore("authData", () => {
  type UserMe = {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    avatar: string | null;
    language: null;
    appearance: null;
    role: { name: string };
    role_type: string;
    modules: Array<{ modules_id: { code: string } }>;
  };

  const userModules = computed(() => {
    if (!dataUser.value?.modules) return [];
    return dataUser.value.modules.map((m) => m.modules_id.code);
  });

  const hasModule = (moduleCode: string) => {
    return userModules.value.includes(moduleCode);
  };

  const appLoad = ref<boolean>(true);
  const isSignedIn = ref<boolean>(false);
  const accessToken = ref<string>("");
  const dataUser = ref<UserMe>();
  function signin(newToken: string) {
    isSignedIn.value = true;
    accessToken.value = newToken;
    appLoad.value = false;
  }

  async function getDetailUser(token: string) {
    const response = await fetch(
      "/panel/users/me?fields=first_name,last_name,id,email,avatar,language,appearance,role.name, role.role_type,modules.modules_id.code, area_province, area_city ",
      {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
      },
    );

    const data = await response.json();
    const user: UserMe = data.data;
    dataUser.value = user;
  }
  async function signout() {
    isSignedIn.value = false;
    accessToken.value = "";
    await fetch("/panel/auth/logout", {
      method: "POST",
      body: JSON.stringify({
        mode: "cookie",
      }),
    });
    appLoad.value = false;
    localStorage.removeItem(expiresTokenKey);
    navigateTo("/");
  }
  const authModal = ref<boolean>(false);
  function mutateAuthModal(newState?: boolean) {
    if (typeof newState === "undefined") {
      authModal.value = !authModal.value;
    } else {
      authModal.value = newState;
    }
  }

  const tryRefresh = async () => {
    try {
      const { data } = await $fetch<{ data: AuthPayload }>(
        "/panel/auth/refresh",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "cookie",
          }),
        },
      );
      signin(data.access_token);
      getDetailUser(data.access_token);
      localStorage.setItem(
        expiresTokenKey,
        (Date.now() + data.expires - 10000).toString(),
      );
      setTimeout(() => {
        tryRefresh();
      }, data.expires - 1000);
    } catch (error) {
      isSignedIn.value = false;
      accessToken.value = "";
      localStorage.removeItem(expiresTokenKey);
      signout();
    } finally {
      setTimeout(() => {
        appLoad.value = false;
      }, 5);
    }
  };

  return {
    isSignedIn,
    accessToken,
    signin,
    signout,
    authModal,
    mutateAuthModal,
    appLoad,
    tryRefresh,
    getDetailUser,
    dataUser,
    userModules,
    hasModule,
  };
});
