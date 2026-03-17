<script lang="ts">
	import { onMount } from 'svelte';
	import { dataStore } from '$stores/data.svelte';
	import { settingsStore } from '$stores/settings.svelte';
	import { setupStore } from '$stores/setup.svelte';
	import { uiStore } from '$stores/ui.svelte';
	import QuickSetup from '$components/QuickSetup.svelte';
	import ListCard from '$components/ListCard.svelte';
	import PrizeCard from '$components/PrizeCard.svelte';
	import ConfirmModal from '$components/ConfirmModal.svelte';
	import SelectionView from '$components/SelectionView.svelte';
	import ImportWizard from '$components/ImportWizard.svelte';
	import FormModal from '$components/FormModal.svelte';
	import WinnerFilters from '$components/WinnerFilters.svelte';
	import HistoryFilters from '$components/HistoryFilters.svelte';
	import { winnersFilterStore, historyFilterStore } from '$stores/filters.svelte';
	import type { List, Prize } from '$types';

	// Modal state
	let deleteListModal: ConfirmModal;
	let deletePrizeModal: ConfirmModal;
	let prizeFormModal: FormModal;
	let importModal: FormModal;
	let pendingDeleteList: List | null = $state(null);
	let pendingDeletePrize: Prize | null = $state(null);
	let showImportWizard = $state(false);

	// Prize form state
	let editingPrize: Prize | null = $state(null);
	let prizeName = $state('');
	let prizeQuantity = $state(1);
	let prizeDescription = $state('');
	let prizeWinnersCount = $state(1);

	// Load data on mount
	onMount(async () => {
		await dataStore.loadAll();
		settingsStore.applyTheme();
	});

	// List actions
	function handleViewList(list: List) {
		console.log('View list:', list.listId);
		// TODO: Open list entries modal
	}

	function handleEditList(list: List) {
		console.log('Edit list:', list.listId);
		// TODO: Open edit list modal
	}

	function handleDeleteList(list: List) {
		pendingDeleteList = list;
		deleteListModal?.show();
	}

	async function confirmDeleteList() {
		if (pendingDeleteList) {
			await dataStore.delete('lists', pendingDeleteList.listId);
			pendingDeleteList = null;
		}
	}

	// Prize actions
	function handleAddPrize() {
		editingPrize = null;
		prizeName = '';
		prizeQuantity = 1;
		prizeDescription = '';
		prizeWinnersCount = 1;
		prizeFormModal?.show();
	}

	function handleEditPrize(prize: Prize) {
		editingPrize = prize;
		prizeName = prize.name;
		prizeQuantity = prize.quantity;
		prizeDescription = prize.description || '';
		prizeWinnersCount = prize.winnersCount || 1;
		prizeFormModal?.show();
	}

	async function handleSavePrize() {
		const prizeData = {
			prizeId: editingPrize?.prizeId || crypto.randomUUID(),
			name: prizeName.trim(),
			quantity: prizeQuantity,
			description: prizeDescription.trim() || undefined,
			winnersCount: prizeWinnersCount,
			timestamp: editingPrize?.timestamp || Date.now(),
			templateId: editingPrize?.templateId
		};
		await dataStore.save('prizes', prizeData);
	}

	function handleDeletePrize(prize: Prize) {
		pendingDeletePrize = prize;
		deletePrizeModal?.show();
	}

	async function confirmDeletePrize() {
		if (pendingDeletePrize) {
			await dataStore.delete('prizes', pendingDeletePrize.prizeId);
			pendingDeletePrize = null;
		}
	}
</script>

<!-- Public Selection Interface -->
{#if uiStore.view === 'public'}
	<div class="public-selection-interface">
		<header class="selection-header">
			<div class="d-flex align-items-center gap-2">
				<h1 class="h5 mb-0 text-white">Winner Selection</h1>
				{#if setupStore.selectedPrizeId}
					<span class="badge bg-warning text-dark">
						<i class="bi bi-trophy me-1"></i>{setupStore.prizeDisplayText}
					</span>
				{/if}
			</div>
			<div class="d-flex align-items-center gap-2">
				<button
					class="btn btn-outline-light btn-sm"
					onclick={() => {
						if (document.fullscreenElement) {
							document.exitFullscreen();
						} else {
							document.documentElement.requestFullscreen();
						}
					}}
					title="Toggle fullscreen"
					aria-label="Toggle fullscreen mode"
				>
					<i class="bi bi-arrows-fullscreen"></i>
				</button>
				<button class="btn btn-light btn-sm" onclick={() => uiStore.showManagement()}>
					<i class="bi bi-gear"></i>
					<span class="d-none d-sm-inline ms-1">Manage</span>
				</button>
			</div>
		</header>

		<SelectionView />
	</div>

<!-- Management Interface -->
{:else}
	<div class="management-interface">
		<header class="management-header bg-primary text-white p-3">
			<div class="container-fluid d-flex justify-content-between align-items-center">
				<h1 class="h5 mb-0">Winner Selection - Management</h1>
				<button class="btn btn-light btn-sm" onclick={() => uiStore.showPublic()}>
					<i class="bi bi-arrow-left"></i>
					<span class="ms-1">Back to Selection</span>
				</button>
			</div>
		</header>

		<div class="container-fluid py-4">
			<!-- Tab Navigation -->
			<ul class="nav nav-tabs mb-4" role="tablist">
				<li class="nav-item">
					<button
						class="nav-link"
						class:active={uiStore.currentTab === 'quicksetup'}
						onclick={() => uiStore.setTab('quicksetup')}
					>
						<i class="bi bi-lightning"></i>
						<span class="d-none d-md-inline ms-1">Quick Setup</span>
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link"
						class:active={uiStore.currentTab === 'lists'}
						onclick={() => uiStore.setTab('lists')}
					>
						<i class="bi bi-list-ul"></i>
						<span class="d-none d-md-inline ms-1">Lists</span>
						<span class="badge bg-secondary ms-1">{dataStore.lists.length}</span>
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link"
						class:active={uiStore.currentTab === 'prizes'}
						onclick={() => uiStore.setTab('prizes')}
					>
						<i class="bi bi-trophy"></i>
						<span class="d-none d-md-inline ms-1">Prizes</span>
						<span class="badge bg-secondary ms-1">{dataStore.prizes.length}</span>
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link"
						class:active={uiStore.currentTab === 'winners'}
						onclick={() => uiStore.setTab('winners')}
					>
						<i class="bi bi-people"></i>
						<span class="d-none d-md-inline ms-1">Winners</span>
						<span class="badge bg-secondary ms-1">{dataStore.winners.length}</span>
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link"
						class:active={uiStore.currentTab === 'history'}
						onclick={() => uiStore.setTab('history')}
					>
						<i class="bi bi-clock-history"></i>
						<span class="d-none d-md-inline ms-1">History</span>
					</button>
				</li>
				<li class="nav-item">
					<button
						class="nav-link"
						class:active={uiStore.currentTab === 'settings'}
						onclick={() => uiStore.setTab('settings')}
					>
						<i class="bi bi-gear"></i>
						<span class="d-none d-md-inline ms-1">Settings</span>
					</button>
				</li>
			</ul>

			<!-- Tab Content -->
			<div class="tab-content">
				{#if uiStore.currentTab === 'quicksetup'}
					<QuickSetup />
				{:else if uiStore.currentTab === 'lists'}
					{#if showImportWizard}
						<div class="card">
							<div class="card-header d-flex justify-content-between align-items-center">
								<h5 class="card-title mb-0">
									<i class="bi bi-upload me-2"></i>Import List
								</h5>
								<button class="btn btn-outline-secondary btn-sm" onclick={() => (showImportWizard = false)}>
									<i class="bi bi-x"></i> Cancel
								</button>
							</div>
							<div class="card-body">
								<ImportWizard
									onComplete={() => (showImportWizard = false)}
									onCancel={() => (showImportWizard = false)}
								/>
							</div>
						</div>
					{:else}
						<div class="card">
							<div class="card-header d-flex justify-content-between align-items-center">
								<h5 class="card-title mb-0">
									<i class="bi bi-list-ul me-2"></i>Lists
								</h5>
								<button class="btn btn-primary btn-sm" onclick={() => (showImportWizard = true)}>
									<i class="bi bi-plus"></i> Import List
								</button>
							</div>
							<div class="card-body">
								{#if dataStore.loading.lists}
									<div class="text-center py-4">
										<div class="spinner-border text-primary" role="status">
											<span class="visually-hidden">Loading...</span>
										</div>
									</div>
								{:else if dataStore.lists.length === 0}
									<p class="text-muted text-center py-4">No lists yet. Click "Import List" to upload a CSV.</p>
								{:else}
									<div class="row g-3">
										{#each dataStore.lists as list (list.listId)}
											<div class="col-md-4 col-lg-3">
												<ListCard
													{list}
													onView={handleViewList}
													onEdit={handleEditList}
													onDelete={handleDeleteList}
												/>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{/if}
				{:else if uiStore.currentTab === 'prizes'}
					<div class="card">
						<div class="card-header d-flex justify-content-between align-items-center">
							<h5 class="card-title mb-0">
								<i class="bi bi-trophy me-2"></i>Prizes
							</h5>
							<button class="btn btn-primary btn-sm" onclick={handleAddPrize}>
								<i class="bi bi-plus"></i> Add Prize
							</button>
						</div>
						<div class="card-body">
							{#if dataStore.loading.prizes}
								<div class="text-center py-4">
									<div class="spinner-border text-primary" role="status">
										<span class="visually-hidden">Loading...</span>
									</div>
								</div>
							{:else if dataStore.prizes.length === 0}
								<p class="text-muted text-center py-4">No prizes yet. Add a prize to get started.</p>
							{:else}
								<div class="row g-3">
									{#each dataStore.prizes as prize (prize.prizeId)}
										<div class="col-md-4 col-lg-3">
											<PrizeCard
												{prize}
												onEdit={handleEditPrize}
												onDelete={handleDeletePrize}
											/>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{:else if uiStore.currentTab === 'winners'}
					<div class="card">
						<div class="card-header">
							<h5 class="card-title mb-0"><i class="bi bi-people me-2"></i>Winners</h5>
						</div>
						<div class="card-body">
							{#if dataStore.loading.winners}
								<div class="text-center py-4">
									<div class="spinner-border text-primary" role="status">
										<span class="visually-hidden">Loading...</span>
									</div>
								</div>
							{:else if dataStore.winners.length === 0}
								<p class="text-muted text-center py-4">No winners yet. Run a selection to get started.</p>
							{:else}
								<WinnerFilters />
								<div class="table-responsive">
									<table class="table table-striped table-hover">
										<thead>
											<tr>
												<th
													class="sortable"
													onclick={() => winnersFilterStore.toggleSort('name')}
												>
													Name
													{#if winnersFilterStore.sortField === 'name'}
														<i class="bi bi-caret-{winnersFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => winnersFilterStore.toggleSort('prize')}
												>
													Prize
													{#if winnersFilterStore.sortField === 'prize'}
														<i class="bi bi-caret-{winnersFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => winnersFilterStore.toggleSort('list')}
												>
													List
													{#if winnersFilterStore.sortField === 'list'}
														<i class="bi bi-caret-{winnersFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => winnersFilterStore.toggleSort('date')}
												>
													Date
													{#if winnersFilterStore.sortField === 'date'}
														<i class="bi bi-caret-{winnersFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => winnersFilterStore.toggleSort('pickup')}
												>
													Status
													{#if winnersFilterStore.sortField === 'pickup'}
														<i class="bi bi-caret-{winnersFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
											</tr>
										</thead>
										<tbody>
											{#each winnersFilterStore.filtered as winner (winner.winnerId)}
												<tr>
													<td>{winner.displayName}</td>
													<td>{winner.prize}</td>
													<td>{winner.listName}</td>
													<td>{new Date(winner.timestamp).toLocaleDateString()}</td>
													<td>
														{#if winner.pickedUp}
															<span class="badge bg-success">Picked Up</span>
														{:else}
															<span class="badge bg-warning">Pending</span>
														{/if}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if winnersFilterStore.filtered.length === 0}
									<p class="text-muted text-center py-3">No winners match the current filters.</p>
								{/if}
							{/if}
						</div>
					</div>
				{:else if uiStore.currentTab === 'history'}
					<div class="card">
						<div class="card-header">
							<h5 class="card-title mb-0"><i class="bi bi-clock-history me-2"></i>Selection History</h5>
						</div>
						<div class="card-body">
							{#if dataStore.history.length === 0}
								<p class="text-muted text-center py-4">No selection history yet.</p>
							{:else}
								<HistoryFilters />
								<div class="table-responsive">
									<table class="table table-striped table-hover">
										<thead>
											<tr>
												<th
													class="sortable"
													onclick={() => historyFilterStore.toggleSort('date')}
												>
													Date
													{#if historyFilterStore.sortField === 'date'}
														<i class="bi bi-caret-{historyFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => historyFilterStore.toggleSort('list')}
												>
													List
													{#if historyFilterStore.sortField === 'list'}
														<i class="bi bi-caret-{historyFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => historyFilterStore.toggleSort('prize')}
												>
													Prize
													{#if historyFilterStore.sortField === 'prize'}
														<i class="bi bi-caret-{historyFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
												<th
													class="sortable"
													onclick={() => historyFilterStore.toggleSort('count')}
												>
													Winners
													{#if historyFilterStore.sortField === 'count'}
														<i class="bi bi-caret-{historyFilterStore.sortDir === 'asc' ? 'up' : 'down'}-fill ms-1"></i>
													{/if}
												</th>
											</tr>
										</thead>
										<tbody>
											{#each historyFilterStore.filtered as entry (entry.historyId)}
												<tr>
													<td>{new Date(entry.timestamp).toLocaleString()}</td>
													<td>{entry.listName}</td>
													<td>{entry.prizeName}</td>
													<td><span class="badge bg-primary">{entry.winnersCount}</span></td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if historyFilterStore.filtered.length === 0}
									<p class="text-muted text-center py-3">No history entries match the current filters.</p>
								{/if}
							{/if}
						</div>
					</div>
				{:else if uiStore.currentTab === 'settings'}
					<div class="card">
						<div class="card-header">
							<h5 class="card-title">Settings</h5>
						</div>
						<div class="card-body">
							<div class="row g-4">
								<div class="col-md-6">
									<h6>General</h6>
									<div class="form-check mb-2">
										<input
											type="checkbox"
											class="form-check-input"
											id="preventDuplicates"
											checked={settingsStore.preventDuplicates}
											onchange={(e) => (settingsStore.preventDuplicates = e.currentTarget.checked)}
										/>
										<label class="form-check-label" for="preventDuplicates">
											Prevent duplicate winners
										</label>
									</div>
									<div class="form-check mb-2">
										<input
											type="checkbox"
											class="form-check-input"
											id="preventSamePrize"
											checked={settingsStore.preventSamePrize}
											onchange={(e) => (settingsStore.preventSamePrize = e.currentTarget.checked)}
										/>
										<label class="form-check-label" for="preventSamePrize">
											Prevent same person winning same prize twice
										</label>
									</div>
									<div class="form-check mb-2">
										<input
											type="checkbox"
											class="form-check-input"
											id="hideEntryCounts"
											checked={settingsStore.hideEntryCounts}
											onchange={(e) => (settingsStore.hideEntryCounts = e.currentTarget.checked)}
										/>
										<label class="form-check-label" for="hideEntryCounts">
											Hide entry counts in public view
										</label>
									</div>
									<h6 class="mt-3">Developer</h6>
									<div class="form-check mb-2">
										<input
											type="checkbox"
											class="form-check-input"
											id="enableDebugLogs"
											checked={settingsStore.enableDebugLogs}
											onchange={(e) => (settingsStore.enableDebugLogs = e.currentTarget.checked)}
										/>
										<label class="form-check-label" for="enableDebugLogs">
											Enable debug logs
										</label>
									</div>
									<div class="form-check mb-2">
										<input
											type="checkbox"
											class="form-check-input"
											id="enableWebhook"
											checked={settingsStore.enableWebhook}
											onchange={(e) => (settingsStore.enableWebhook = e.currentTarget.checked)}
										/>
										<label class="form-check-label" for="enableWebhook">
											Enable webhook notifications
										</label>
									</div>
								</div>
								<div class="col-md-6">
									<h6>Theme</h6>
									<div class="mb-3">
										<label class="form-label" for="primaryColor">Primary Color</label>
										<input
											type="color"
											class="form-control form-control-color"
											id="primaryColor"
											value={settingsStore.primaryColor}
											onchange={(e) => {
												settingsStore.primaryColor = e.currentTarget.value;
												settingsStore.applyTheme();
											}}
										/>
									</div>
									<div class="mb-3">
										<label class="form-label" for="secondaryColor">Secondary Color</label>
										<input
											type="color"
											class="form-control form-control-color"
											id="secondaryColor"
											value={settingsStore.secondaryColor}
											onchange={(e) => {
												settingsStore.secondaryColor = e.currentTarget.value;
												settingsStore.applyTheme();
											}}
										/>
									</div>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Modals -->
<ConfirmModal
	id="delete-list-modal"
	title="Delete List"
	message="Are you sure you want to delete '{pendingDeleteList?.metadata.name}'? This action cannot be undone."
	confirmText="Delete"
	variant="danger"
	onConfirm={confirmDeleteList}
	bind:this={deleteListModal}
/>

<ConfirmModal
	id="delete-prize-modal"
	title="Delete Prize"
	message="Are you sure you want to delete '{pendingDeletePrize?.name}'? This action cannot be undone."
	confirmText="Delete"
	variant="danger"
	onConfirm={confirmDeletePrize}
	bind:this={deletePrizeModal}
/>

<FormModal
	id="prize-form-modal"
	title={editingPrize ? 'Edit Prize' : 'Add Prize'}
	submitText={editingPrize ? 'Save Changes' : 'Add Prize'}
	onSubmit={handleSavePrize}
	bind:this={prizeFormModal}
>
	<div class="mb-3">
		<label class="form-label" for="prize-name">Prize Name <span class="text-danger">*</span></label>
		<input
			type="text"
			class="form-control"
			id="prize-name"
			bind:value={prizeName}
			required
			placeholder="e.g., Grand Prize, Gift Card"
		/>
	</div>
	<div class="row g-3 mb-3">
		<div class="col-6">
			<label class="form-label" for="prize-quantity">Quantity <span class="text-danger">*</span></label>
			<input
				type="number"
				class="form-control"
				id="prize-quantity"
				bind:value={prizeQuantity}
				required
				min="0"
			/>
		</div>
		<div class="col-6">
			<label class="form-label" for="prize-winners">Default Winners</label>
			<input
				type="number"
				class="form-control"
				id="prize-winners"
				bind:value={prizeWinnersCount}
				min="1"
			/>
			<small class="text-muted">Pre-fills selection count</small>
		</div>
	</div>
	<div class="mb-3">
		<label class="form-label" for="prize-description">Description</label>
		<textarea
			class="form-control"
			id="prize-description"
			bind:value={prizeDescription}
			rows="2"
			placeholder="Optional description..."
		></textarea>
	</div>
</FormModal>

<style>
	/* Additional component-specific styles */
	.management-header {
		position: sticky;
		top: 0;
		z-index: 1000;
	}

	.nav-link {
		cursor: pointer;
	}
</style>
