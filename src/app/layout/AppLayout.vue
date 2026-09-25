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
}

.app-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
</style>
