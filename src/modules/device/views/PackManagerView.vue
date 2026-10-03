<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NInput, NPopconfirm, NTag, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { TargetCatalogService, type PackAnalysis, type PackRecord } from "@/services/native/target-catalog-service";

const { t } = useI18n();
const message = useMessage();
const packs = ref<PackRecord[]>([]);
const analyses = ref<PackAnalysis[]>([]);
const selectedId = ref("");
const query = ref("");
const busy = ref(false);
const selected = computed(() => packs.value.find((pack) => pack.id === selectedId.value));
const analysis = computed(() => analyses.value.find((item) => item.packId === selected.value?.id && item.sha256 === selected.value?.sha256));
const targetByName = computed(() => new Map(analysis.value?.targets.map((target) => [target.name, target]) ?? []));
const readyTargetCount = computed(() => analysis.value?.targets.filter((target) => target.ready).length ?? 0);
const devices = computed(() => selected.value?.devices.filter((device) => `${device.name} ${device.family}`.toLowerCase().includes(query.value.toLowerCase())) ?? []);
async function refresh() {
  try {
    packs.value = await TargetCatalogService.list();
    analyses.value = await TargetCatalogService.listAnalyses();
    if (!packs.value.some((pack) => pack.id === selectedId.value)) selectedId.value = packs.value[0]?.id ?? "";
  } catch (error) { message.error(String(error)); }
}
async function analyze(pack: PackRecord) {
  const result = await TargetCatalogService.analyze(pack);
  analyses.value = [...analyses.value.filter((item) => item.packId !== result.packId || item.sha256 !== result.sha256), result];
  message.success(t("targetCatalog.analyzed", { ready: result.targets.filter((target) => target.ready).length }));
}
async function importPack() {
  busy.value = true;
  try {
    const pack = await TargetCatalogService.pickAndImport();
    if (pack) {
      await refresh();
      selectedId.value = pack.id;
      await analyze(pack);
    }
  } catch (error) { message.error(String(error)); }
  finally { busy.value = false; }
}
async function analyzeSelected() {
  if (!selected.value) return;
  busy.value = true;
  try { await analyze(selected.value); }
  catch (error) { message.error(String(error)); }
  finally { busy.value = false; }
}
async function removeSelected() {
  if (!selected.value || busy.value) return;
  const pack = selected.value;
  busy.value = true;
  try {
    await TargetCatalogService.remove(pack);
    selectedId.value = "";
    query.value = "";
    await refresh();
    message.success(t("packManager.removed"));
  } catch (error) { message.error(String(error)); }
  finally { busy.value = false; }
}
onMounted(refresh);
</script>

<template>
  <div class="pack-manager">
    <header class="page-header">
      <div><h1>{{ t("tools.packManager") }}</h1><p>{{ t("packManager.description") }}</p></div>
      <NButton type="primary" :loading="busy" @click="importPack">{{ t("targetCatalog.import") }}</NButton>
    </header>
    <div class="columns">
      <aside class="panel pack-list">
        <h2>{{ t("targetCatalog.packs") }}</h2>
        <p v-if="!packs.length">{{ t("targetCatalog.empty") }}</p>
        <button v-for="pack in packs" :key="pack.id" class="pack-item" :class="{ active: selectedId === pack.id }" @click="selectedId = pack.id">
          <strong>{{ pack.vendor }} {{ pack.name }}</strong><small>v{{ pack.version }} · {{ pack.devices.length }} {{ t("targetCatalog.devices") }}</small>
        </button>
      </aside>
      <main v-if="selected" class="panel detail">
        <div class="detail-heading"><div><h2>{{ selected.vendor }} {{ selected.name }}</h2><p>v{{ selected.version }} · {{ selected.devices.length }} {{ t("targetCatalog.devices") }}</p></div><div class="heading-actions"><RouterLink to="/device/programmer">{{ t("packManager.openProgrammer") }} →</RouterLink><NPopconfirm :positive-text="t('packManager.confirmRemove')" :negative-text="t('packManager.cancelRemove')" @positive-click="removeSelected"><template #trigger><NButton type="error" secondary size="small" :disabled="busy">{{ t("packManager.remove") }}</NButton></template>{{ t("packManager.removeWarning", { name: `${selected.vendor} ${selected.name} v${selected.version}` }) }}</NPopconfirm></div></div>
        <p class="hash">SHA-256: {{ selected.sha256 }}</p>
        <div class="summary"><NTag :type="analysis ? 'success' : 'warning'">{{ analysis ? t("packManager.validated", { ready: readyTargetCount, total: analysis.targets.length }) : t("packManager.needsValidation") }}</NTag><NButton size="small" :loading="busy" @click="analyzeSelected">{{ t("targetCatalog.analyze") }}</NButton></div>
        <NInput v-model:value="query" :placeholder="t('targetCatalog.search')" clearable />
        <div class="device-list"><div v-for="device in devices" :key="device.name" class="device-row"><div><strong>{{ device.name }}</strong><small>{{ device.family }} · {{ device.core || t("targetCatalog.coreUnknown") }}</small></div><NTag size="small" :type="!analysis ? 'default' : targetByName.get(device.name)?.ready ? 'success' : 'warning'">{{ !analysis ? t("packManager.needsValidation") : targetByName.get(device.name)?.ready ? t("targetCatalog.ready") : t("targetCatalog.invalid") }}</NTag></div></div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.pack-manager{padding:28px;max-width:1320px;margin:auto}.page-header,.detail-heading,.summary{display:flex;justify-content:space-between;align-items:center;gap:16px}.page-header{margin-bottom:24px}.page-header h1,.detail h2{margin:0}.page-header p,.detail-heading p{margin:5px 0 0;opacity:.7}.heading-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.columns{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px}.panel{border:1px solid #8884;border-radius:12px;padding:20px;min-width:0}.panel h2{margin-top:0}.pack-item{display:flex;flex-direction:column;width:100%;padding:13px;margin:8px 0;text-align:left;color:inherit;background:transparent;border:1px solid #8885;border-radius:8px;cursor:pointer}.pack-item.active{border-color:#18a058;background:#18a05814}.pack-item small,.device-row small{opacity:.65;margin-top:4px}.hash{font-size:12px;opacity:.6;overflow-wrap:anywhere}.summary{justify-content:flex-start;margin:18px 0}.device-list{margin-top:12px}.device-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid #8883}.device-row>div{display:flex;flex-direction:column}@media(max-width:760px){.columns{grid-template-columns:1fr}.page-header{align-items:flex-start}.detail-heading{align-items:flex-start;flex-direction:column}}
</style>
