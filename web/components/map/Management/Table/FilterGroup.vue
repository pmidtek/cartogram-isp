<script lang="ts" setup>
const props = defineProps<{
  groupItem: any;
  fieldOption: { key: string; label: string; type: string }[];
  updateItem: any;
  addFilter: any;
  deleteItem: any;
}>();

watchEffect(() => {
  console.log("groups");
});
</script>

<template>
  <div class="flex items-center gap-2 mt-2">
    <p>{{ groupItem.group.replace("_", "").toUpperCase() }}</p>
    <button class="text-xs" @click="() => addFilter(groupItem)">
      add group
    </button>
    <button class="text-xs" @click="() => addFilter(groupItem)">
      add filter
    </button>
    <button class="text-xs">delete</button>
  </div>
  <div v-for="filter of groupItem.filterList" class="pl-5">
    <MapManagementTableFilterGroup
      v-if="filter.group"
      :groupItem="filter"
      :fieldOption="fieldOption"
      :updateItem="updateItem"
      :addFilter="addFilter"
      :deleteItem="deleteItem"
    />
    <div v-else>
      <MapManagementTableFilterItem
        :fieldOption="fieldOption"
        :item="filter"
        :updateItem="updateItem"
        :deleteItem="deleteItem"
      />
    </div>
  </div>
</template>
