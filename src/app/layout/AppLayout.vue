<script setup lang="ts">
import AppSidebar from "./AppSidebar.vue";
import AppToolbar from "./AppToolbar.vue";
</script>

<template>
  <div class="app-layout">
    <AppSidebar />
    <div class="app-main">
      <AppToolbar />
      <main class="app-content">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.app-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  /* 允许纵向收缩，否则长页面会把内容撑出容器而无法滚动。 */
  min-height: 0;
}

.app-content {
  flex: 1;
  /* 与 .app-main 同理：flex 子项默认 min-height:auto 会阻止出现滚动条。 */
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
</style>
