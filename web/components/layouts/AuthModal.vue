<script setup lang="ts">
import {
  TransitionRoot,
  TransitionChild,
  Dialog,
  DialogPanel,
} from "@headlessui/vue";
import IcAction from "~/assets/icons/ic-action.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import { useGeneralSettings, useMapData } from "~/utils";
import type { FormError, FormSubmitEvent } from "#ui/types";
import { expiresTokenKey } from "~/constants";

defineProps<{
  isExpand: boolean;
}>();

type SigninData = {
  email: string;
  password: string;
};

const authStore = useAuth();
const { data: mapData } = await useMapData();
const { data: generalSettingsData } = await useGeneralSettings();
const signinData = reactive<SigninData>({ email: "", password: "" });
const generalErrorMessage = ref("");
const showPassword = ref(false);
const isLoading = ref(false);

const validateSigninData = (state: SigninData) => {
  const errors: FormError<keyof SigninData>[] = [];
  if (!state.email) errors.push({ path: "email", message: "Required" });
  if (!state.password) errors.push({ path: "password", message: "Required" });
  return errors;
};

const img = useImage();
const bgImgUrl = computed(() =>
  generalSettingsData.value?.data.public_background
    ? `url('${img(generalSettingsData.value.data.public_background, undefined, {
        provider: "directus",
      })}')`
    : null
);

const { signin, tryRefresh } = useAuth();
const handleSignin = async (event: FormSubmitEvent<SigninData>) => {
  generalErrorMessage.value = "";
  isLoading.value = true;
  const { email, password } = event.data;

  try {
    const { data } = await $fetch<{ data: AuthPayload }>("/panel/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, mode: "cookie" }),
    });
    signin(data.access_token);
    localStorage.setItem(
      expiresTokenKey,
      (Date.now() + data.expires - 10000).toString()
    );
    setTimeout(() => {
      tryRefresh();
    }, data.expires - 1000);
    authStore.mutateAuthModal(false);
  } catch (error) {
    generalErrorMessage.value =
      "Signin information is incorrect. Make sure the email and password is correct and try again.";
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <TransitionRoot appear :show="authStore.authModal" as="template">
    <Dialog
      as="div"
      @close="authStore.mutateAuthModal(false)"
      class="relative z-50"
    >
      <TransitionChild
        as="template"
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/25" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center text-center">
          <TransitionChild
            as="template"
            enter="duration-300 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel
              :class="
                'transform overflow-hidden rounded-sm shadow-xl transition-all mx-6 w-full ' +
                (isExpand ? 'mt-24' : 'mt-12')
              "
            >
              <div
                :class="[
                  'flex justify-end w-full rounded-lg h-[calc(100vh-9rem)]',
                  bgImgUrl ? 'bg-cover bg-center' : 'bg-white',
                ]"
                :style="bgImgUrl && `background-image: ${bgImgUrl}`"
              >
                <div class="w-1/2 p-8">
                  <div
                    class="bg-grey-800 rounded-lg h-full px-16 overflow-y-auto"
                  >
                    <div class="flex flex-col text-center space-y-3 mb-16 mt-8">
                      <h2 class="text-xl font-bold text-grey-50 mb-4 font-raleway">Dashboard</h2>
                      <h1 class="text-4xl font-medium text-grey-50">
                        Welcome to {{ mapData?.data.title || "Dashboard" }}
                      </h1>
                      <p class="text-grey-500 text-sm">
                        Sign In to continue your mapping journey with us!
                      </p>
                    </div>
                    <UForm
                      ref="formRef"
                      :validate="validateSigninData"
                      :state="signinData"
                      class="flex flex-col space-y-3 mb-7"
                      @submit="handleSignin"
                    >
                      <UFormGroup name="email">
                        <UInput
                          v-model="signinData.email"
                          type="email"
                          class="w-full"
                          color="gray"
                          size="xl"
                          placeholder="Email"
                          :ui="{ rounded: 'rounded-xxs' }"
                          :disabled="isLoading"
                        />
                      </UFormGroup>
                      <UFormGroup name="password">
                        <UInput
                          v-model="signinData.password"
                          :type="showPassword ? 'text' : 'password'"
                          class="w-full"
                          color="gray"
                          size="xl"
                          placeholder="Password"
                          :ui="{
                            rounded: 'rounded-xxs',
                            icon: { trailing: { pointer: '' } },
                          }"
                          :disabled="isLoading"
                        >
                          <template #trailing>
                            <button
                              type="button"
                              @click="showPassword = !showPassword"
                            >
                              <IcEye
                                v-if="showPassword"
                                class="text-grey-400"
                              />
                              <IcEyeCrossed v-else class="text-grey-400" />
                            </button>
                          </template>
                        </UInput>
                      </UFormGroup>
                      <div
                        v-if="generalErrorMessage"
                        class="flex space-x-2 items-center"
                      >
                        <IcAction class="text-red-500 h-full" />
                        <p class="grow text-xs text-red-500">
                          {{ generalErrorMessage }}
                        </p>
                      </div>
                      <UButton
                        block
                        size="xl"
                        type="submit"
                        label="Sign In"
                        :ui="{ rounded: 'rounded-xxs' }"
                      >
                        <IcSpinner
                          class="text-white animate-spin h-6 w-6 p-1"
                          :fontControlled="false"
                          v-if="isLoading"
                        />
                      </UButton>
                    </UForm>
                    <div class="w-full border border-grey-600 mb-7" />
                    <UButton
                      block
                      variant="outline"
                      size="xl"
                      class="mb-7"
                      label="Sign In with Google"
                      :ui="{ rounded: 'rounded-xxs' }"
                      :disabled="isLoading"
                    >
                      <template #leading>
                        <img
                          src="https://lh3.googleusercontent.com/COxitqgJr1sJnIDe8-jiKhxDx1FrYbtRHKJ9z_hELisAlapwE9LUPh6fcXIfb5vwpbMl4xl9H9TRFPc5NOO8Sb3VSgIBrfRYvW6cUA"
                          class="h-5"
                        />
                      </template>
                    </UButton>
                    <p class="text-center text-grey-500 text-sm mb-8">
                      ©{{ new Date().getFullYear() }} Dashboard
                    </p>
                  </div>
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
