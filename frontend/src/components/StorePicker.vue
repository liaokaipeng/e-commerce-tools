<!-- ② 选择店铺卡片：分组勾选（bidding / bidding-cancel 共用）
     selected 为 reactive Set，沿用「直接操作传入集合」的既有模式。 -->
<script setup>
import { computed } from 'vue';

const props = defineProps({
  stores: { type: Array, default: () => [] },
  selected: { type: Object, required: true }, // reactive Set<shopId>
});

const groups = computed(() => {
  const cats = [...new Set(props.stores.map((s) => s.category))];
  return cats.map((cat) => ({
    category: cat,
    list: props.stores.filter((s) => s.category === cat),
  }));
});

function toggleStore(id, checked) {
  if (checked) props.selected.add(id);
  else props.selected.delete(id);
}

function toggleGroup(cat, checked) {
  const list = props.stores.filter((s) => s.category === cat);
  list.forEach((s) => {
    if (checked) props.selected.add(s.id);
    else props.selected.delete(s.id);
  });
}

function groupState(cat) {
  const list = props.stores.filter((s) => s.category === cat);
  const allChecked = list.length > 0 && list.every((s) => props.selected.has(s.id));
  const some = list.some((s) => props.selected.has(s.id));
  return { allChecked, some };
}
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>② 选择店铺</template>
    <div v-loading="stores.length === 0" class="store-box">
      <div v-for="g in groups" :key="g.category" class="cat-group">
        <div class="cat-head">
          <el-checkbox
            :model-value="groupState(g.category).allChecked"
            :indeterminate="!groupState(g.category).allChecked && groupState(g.category).some"
            @change="(v) => toggleGroup(g.category, v)"
          ></el-checkbox>
          <span>{{ g.category }}</span>
          <span class="cat-count">{{ g.list.length }} 个店铺</span>
        </div>
        <div class="store-grid">
          <label
            v-for="s in g.list"
            :key="s.id"
            class="store-item"
            :class="{ selected: selected.has(s.id) }"
          >
            <el-checkbox :model-value="selected.has(s.id)" @change="(v) => toggleStore(s.id, v)"></el-checkbox>
            <span class="store-meta">
              <span class="store-name">{{ s.name }}</span><br />
              <span class="store-id">ID: {{ s.id }}</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.store-box { min-height: 120px; }
.cat-group { margin-bottom: 18px; }
.cat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 14px;
}
.cat-count { color: #999; font-weight: 400; font-size: 12px; }
.store-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 8px;
}
.store-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.store-item:hover { border-color: #ee4d2d; }
.store-item.selected { border-color: #ee4d2d; background: #fff5f3; }
.store-meta { line-height: 1.35; min-width: 0; }
.store-name { font-size: 13px; font-weight: 600; }
.store-id { font-size: 12px; color: #999; }
</style>
