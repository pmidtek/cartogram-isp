<script lang="ts" setup>
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
const getRandomNumber = () => (Math.random() * 100000).toPrecision(5);

const props = defineProps<{
  columns: TableColumn[];
}>();

const emit = defineEmits<{
  (e: "closeModal"): void;
  (e: "updateQueryFilter", value: any): void;
}>();

const filterObj = ref<any>([
  // {
  //   id: "11111",
  //   group: "or",
  //   filterList: [
  //     { id: "77777", field: "attribute_2", operator: "_eq", value: "test" },
  //     {
  //       id: "99999",
  //       group: "and",
  //       filterList: [
  //         {
  //           id: "66666",
  //           field: "attribute_1",
  //           operator: "_eq",
  //           value: "test",
  //         },
  //         {
  //           id: "12345",
  //           group: "and",
  //           filterList: [
  //             {
  //               id: "23456",
  //               field: "attribute_1",
  //               operator: "_eq",
  //               value: "test",
  //             },
  //           ],
  //         },
  //       ],
  //     },
  //   ],
  // },
  // {
  //   id: "22222",
  //   group: null,
  //   filterList: [
  //     {
  //       id: "33333",
  //       field: "attribute_1",
  //       operator: "_icontains",
  //       value: "ayam",
  //     },
  //   ],
  // },
]);

const addGroupFilterObj = (operator: string) => {
  const prev = [...filterObj.value];
  prev.push({
    id: getRandomNumber(),
    group: operator,
    filterList: [],
  });

  filterObj.value = prev;
};

const addFilterObj = (field: string) => {
  const prev = [...filterObj.value];
  prev.push({
    id: getRandomNumber(),
    group: null,
    filterList: [
      {
        id: getRandomNumber(),
        field: field,
        operator: "_icontains",
        value: "",
      },
    ],
  });
  console.log(prev);

  filterObj.value = prev;
};

function updateFilter(array: any, idToUpdate: any, updatedProperties: any) {
  return array.map((filter: any) => {
    if (filter.id === idToUpdate) {
      return { ...filter, ...updatedProperties };
    }
    if (filter.filterList) {
      filter.filterList = updateFilter(
        filter.filterList,
        idToUpdate,
        updatedProperties
      );
    }
    return filter;
  });
}

function addObjectToFilterList(array: any, objectId: any, newObject: any) {
  for (const obj of array) {
    if (obj.filterList) {
      for (const item of obj.filterList) {
        if (item.id === objectId && item.group === "_and") {
          item.filterList.push(newObject);
          return array;
        } else if (item.group && item.filterList) {
          addObjectToFilterList(item.filterList, objectId, newObject);
        }
      }
    }
  }

  return array;
}

function deleteObjectById(array: any, objectId: any) {
  return array.filter((obj: any) => {
    if (obj.filterList) {
      obj.filterList = obj.filterList.filter((item: any) => {
        if (item.id === objectId) {
          return false; // Remove the object if its ID matches
        } else if (item.group && item.filterList) {
          // Recursively check nested filterList
          item.filterList = deleteObjectById(item.filterList, objectId);
          return true;
        }
        return true;
      });
      return obj.filterList.length > 0; // Keep the object if filterList is not empty
    }
    return true; // Keep the object if it doesn't have filterList
  });
}

function transformObjToQuery(array: any) {
  return array.map((obj: any) => {
    if (obj.group) {
      const newObj = {};
      (newObj as any)[`${obj.group}`] = obj.filterList.map((item: any) => {
        if (item.group) {
          return { [`${item.group}`]: transformObjToQuery([item]) };
        }
        return { [item.field]: { [item.operator]: item.value } };
      });
      return newObj;
    }
    return {
      [obj.filterList[0].field]: {
        [obj.filterList[0].operator]: obj.filterList[0].value,
      },
    };
  });
}
</script>

<template>
  <div class="overflow-auto flex-1">
    <div v-for="filter of filterObj">
      <MapManagementTableFilterGroup
        v-if="filter.group"
        :groupItem="filter"
        :fieldOption="columns"
        :updateItem="
                            (item:any) => {
                              filterObj = updateFilter(
                                filterObj,
                                item.id,
                                item
                              );
                            }
                          "
        :addFilter="(groupItem:any) => {
                            addObjectToFilterList(filterObj, groupItem.id, {id:'111',field:'attribute_1',operator:'_eq',value:''})
                            }"
        :deleteItem="(item:any) => {
                              filterObj = deleteObjectById(filterObj, item.id)
                            }"
      />
      <MapManagementTableFilterItem
        v-else
        :item="filter.filterList[0]"
        :fieldOption="columns"
        :updateItem="
                            (item:any) => {
                              // filterObj = deleteFilterFromArray(
                              //   filterObj,
                              //   item
                              // );
                              filterObj = updateFilter(
                                filterObj,
                                filter.filterList[0].id,
                                item
                              );
                            }
                          "
        :deleteItem="
                            (item:any) => {
                              filterObj = deleteObjectById(filterObj, item.id)
                            }
                          "
      />
    </div>
    <div class="flex gap-2 mt-4">
      <Menu as="div" class="relative inline-block text-left">
        <div>
          <MenuButton
            class="inline-flex w-full justify-center rounded-md bg-black/20 px-4 py-2 text-sm font-medium hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
          >
            Add Group
          </MenuButton>
        </div>

        <MenuItems
          class="absolute left-0 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <MenuItem
            v-for="operator of [
              { label: 'AND', value: '_and' },
              { label: 'OR', value: '_or' },
            ]"
          >
            <button
              @click="
                () => {
                  addGroupFilterObj(operator.value);
                }
              "
              :class="[
                'group flex w-full items-center rounded-md px-2 py-2 text-sm',
              ]"
            >
              {{ operator.label }}
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
      <Menu as="div" class="relative inline-block text-left">
        <div>
          <MenuButton
            class="inline-flex w-full justify-center rounded-md bg-black/20 px-4 py-2 text-sm font-medium hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
          >
            Add Filter
          </MenuButton>
        </div>

        <MenuItems
          class="absolute left-0 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <MenuItem v-for="column of columns">
            <button
              @click="
                () => {
                  addFilterObj(column.key);
                }
              "
              :class="[
                'group flex w-full items-center rounded-md px-2 py-2 text-sm',
              ]"
            >
              {{ column.label }}
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
    <button
      @click="
        () => {
          emit('updateQueryFilter', transformObjToQuery(filterObj));
          emit('closeModal');
        }
      "
      class="mt-4"
    >
      Set Filter
    </button>
  </div>
</template>
