// ========================================================
// 1. INITIALISATION DU CLIENT SUPABASE (Renommé sbClient)
// ========================================================
const SUPABASE_URL = "https://mswgpxjbvzulvehstaqc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KM7WN3oE_z-r2tWFgxXgRA_4R3x_vWr";
const R2_WORKER_URL = "https://r2-upload-signer.serroukhyassir2006.workers.dev";

const sbClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ========================================================
// 2. ÉTAT & LOGIQUE ALPINE.JS
// ========================================================
document.addEventListener("alpine:init", () => {
  Alpine.data("alumlyApp", () => ({
    darkMode:
      localStorage.getItem("theme") === "dark" ||
      (!("theme" in localStorage) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches),
    currentView: "drive",
    isLoading: false,
    currentUser: null,
    isAuthModalOpen: false,
    authTab: "login",
    loginEmail: "",
    loginPassword: "",
    loginError: "",
    registerSubmitted: false,
    regForm: {
      name: "",
      email: "",
      password: "",
      filiere: "MPSI / MP",
      promo: "2026",
      file: null,
    },
    isUploadModalOpen: false,
    newResource: {
      title: "",
      description: "",
      matiere: "maths",
      filiere: "MPSI / MP",
      type: "Fiches",
      tags: "",
      file: null,
    },
    viewMode: "grid",
    searchQuery: "",
    selectedFiliere: "Tous",
    selectedMatiere: "all",
    selectedType: "Tous",
    onlyStarred: false,
    sortBy: "stars",
    resources: [],
    registrationRequests: [],
    userStarredIds: new Set(),
    filieres: ["Tous", "MP2I / MPI", "MPSI / MP", "PCSI / PC", "PSI"],
    matieres: [
      { id: "all", label: "Toutes les matières", icon: "📚" },
      { id: "maths", label: "Mathématiques", icon: "📐" },
      { id: "physique", label: "Physique & Chimie", icon: "⚡" },
      { id: "info", label: "Informatique", icon: "💻" },
      { id: "francais", label: "Français-Philo", icon: "📖" },
      { id: "anglais", label: "Anglais", icon: "🇬🇧" },
    ],
    types: ["Tous", "Fiches", "DS / Concours", "Cours", "Exercices / TD"],

    async init() {
      this.$nextTick(() => lucide.createIcons());
      if (!sbClient) {
        console.warn("Supabase n'est pas initialisé. Vérifiez vos clés.");
        return;
      }

      sbClient.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          await this.fetchUserProfile(session.user);
        } else {
          this.currentUser = null;
        }
        await this.loadResources();
        this.$nextTick(() => lucide.createIcons());
      });

      await this.loadResources();
    },

    async fetchUserProfile(user) {
      try {
        const { data } = await sbClient
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (data) {
          this.currentUser = {
            id: user.id,
            name: data.full_name,
            email: user.email,
            role: data.role,
            filiere: data.filiere,
            promo: data.promo,
          };
          if (this.currentUser.role === "admin") {
            await this.loadRegistrationRequests();
          }
        } else {
          this.currentUser = {
            id: user.id,
            name: user.email.split("@")[0],
            email: user.email,
            role: "student",
          };
        }
      } catch (err) {
        console.error("Erreur profil :", err);
      }
    },

    async handleLogin() {
      this.loginError = "";
      this.isLoading = true;
      try {
        const { error } = await sbClient.auth.signInWithPassword({
          email: this.loginEmail.toLowerCase().trim(),
          password: this.loginPassword,
        });
        if (error) throw error;
        this.isAuthModalOpen = false;
        this.loginPassword = "";
      } catch (err) {
        this.loginError = err.message || "Erreur de connexion.";
      } finally {
        this.isLoading = false;
      }
    },

    async logout() {
      if (sbClient) await sbClient.auth.signOut();
      this.currentUser = null;
      this.currentView = "drive";
      this.userStarredIds.clear();
      this.$nextTick(() => lucide.createIcons());
    },

    async loadResources() {
      if (!sbClient) return;
      try {
        const { data, error } = await sbClient
          .from("resources")
          .select("*")
          .order("stars", { ascending: false });

        if (error) throw error;
        this.resources = data.map((r) => ({
          ...r,
          isStarred: this.userStarredIds.has(r.id),
        }));

        if (this.currentUser) {
          const { data: userStars } = await sbClient
            .from("user_stars")
            .select("resource_id")
            .eq("user_id", this.currentUser.id);

          if (userStars) {
            this.userStarredIds = new Set(userStars.map((s) => s.resource_id));
            this.resources.forEach((r) => {
              r.isStarred = this.userStarredIds.has(r.id);
            });
          }
        }
      } catch (err) {
        console.error("Erreur ressources :", err);
      } finally {
        this.$nextTick(() => lucide.createIcons());
      }
    },

    async toggleStar(item) {
      if (!this.currentUser) {
        this.openAuthModal("login");
        return;
      }
      const wasStarred = item.isStarred;
      item.isStarred = !wasStarred;
      item.stars += item.isStarred ? 1 : -1;

      try {
        if (item.isStarred) {
          this.userStarredIds.add(item.id);
          await sbClient
            .from("user_stars")
            .insert({ user_id: this.currentUser.id, resource_id: item.id });
        } else {
          this.userStarredIds.delete(item.id);
          await sbClient
            .from("user_stars")
            .delete()
            .match({ user_id: this.currentUser.id, resource_id: item.id });
        }
        await sbClient
          .from("resources")
          .update({ stars: item.stars })
          .eq("id", item.id);
      } catch (err) {
        console.error("Erreur favori :", err);
      } finally {
        this.$nextTick(() => lucide.createIcons());
      }
    },

    async handleUploadResource(event) {
      const fileInput = event.target.querySelector('input[type="file"]');
      const file = fileInput?.files[0];
      if (!file || !this.newResource.title) {
        alert("Veuillez renseigner un titre et sélectionner un fichier PDF.");
        return;
      }

      this.isLoading = true;
      try {
        const uploadRes = await fetch(R2_WORKER_URL, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/pdf",
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Type": file.type || "application/pdf",
          },
          body: file,
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}));
          throw new Error(
            errData.error || "Échec de l'envoi vers Cloudflare R2",
          );
        }

        const { publicUrl } = await uploadRes.json();
        const tagsArray = this.newResource.tags
          ? this.newResource.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];

        const { error: dbError } = await sbClient.from("resources").insert({
          title: this.newResource.title,
          description: this.newResource.description,
          matiere: this.newResource.matiere,
          filiere: this.newResource.filiere,
          type: this.newResource.type,
          author: this.currentUser?.name || "Anonyme",
          year: new Date().getFullYear().toString(),
          file_url: publicUrl,
          tags: tagsArray,
        });

        if (dbError) throw dbError;

        this.isUploadModalOpen = false;
        this.newResource = {
          title: "",
          description: "",
          matiere: "maths",
          filiere: "MPSI / MP",
          type: "Fiches",
          tags: "",
        };
        await this.loadResources();
        alert("Ressource uploadée et publiée avec succès !");
      } catch (err) {
        console.error("Erreur upload :", err);
        alert("Échec de l'upload : " + err.message);
      } finally {
        this.isLoading = false;
      }
    },

    async submitRegistrationRequest(event) {
      const fileInput = event.target
        .closest("form")
        ?.querySelector('input[type="file"]');
      const file = fileInput?.files[0];

      if (
        !this.regForm.name ||
        !this.regForm.email ||
        !this.regForm.password ||
        !file
      ) {
        alert(
          "Remplissez tous les champs (nom, email, mot de passe) et joignez votre justificatif.",
        );
        return;
      }

      if (this.regForm.password.length < 6) {
        alert("Le mot de passe doit contenir au moins 6 caractères.");
        return;
      }

      this.isLoading = true;
      try {
        const fileExt = file.name.split(".").pop();
        const cleanName = this.regForm.name.trim().replace(/\s+/g, "_");
        const filePath = `justificatifs/${Date.now()}_${cleanName}.${fileExt}`;

        const { error: uploadError } = await sbClient.storage
          .from("proofs")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { error: dbError } = await sbClient
          .from("registration_requests")
          .upsert(
            {
              full_name: this.regForm.name.trim(),
              email: this.regForm.email.toLowerCase().trim(),
              password: this.regForm.password,
              filiere: this.regForm.filiere,
              promo: parseInt(this.regForm.promo, 10),
              proof_url: filePath,
              status: "pending",
            },
            { onConflict: "email" },
          );

        if (dbError) throw dbError;

        this.regForm.password = "";
        if (fileInput) fileInput.value = "";
        this.registerSubmitted = true;
      } catch (err) {
        console.error("Erreur soumission :", err);
        alert("Erreur lors de la soumission : " + err.message);
      } finally {
        this.isLoading = false;
        this.$nextTick(() => lucide.createIcons());
      }
    },

    async loadRegistrationRequests() {
      if (!sbClient) return;
      try {
        const { data, error } = await sbClient
          .from("registration_requests")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        this.registrationRequests = data;
      } catch (err) {
        console.error("Erreur demandes :", err);
      }
    },

    get pendingCount() {
      return this.registrationRequests.filter((r) => r.status === "pending")
        .length;
    },

    async approveRequest(req) {
      if (
        !confirm(
          `Valider et créer le compte pour ${req.full_name} (${req.email}) ?`,
        )
      ) {
        return;
      }

      this.isLoading = true;
      try {
        const { data, error } = await sbClient.functions.invoke(
          "approve-user",
          {
            body: { requestId: req.id },
          },
        );

        if (error) throw error;
        req.status = "approved";
        alert(
          `Compte validé avec succès pour ${req.full_name} ! L'élève peut désormais se connecter.`,
        );
      } catch (err) {
        console.error("Erreur validation :", err);
        alert("Échec de l'approbation : " + err.message);
      } finally {
        this.isLoading = false;
        this.$nextTick(() => lucide.createIcons());
      }
    },

    async rejectRequest(req) {
      try {
        const { error } = await sbClient
          .from("registration_requests")
          .update({ status: "rejected" })
          .eq("id", req.id);

        if (error) throw error;
        req.status = "rejected";
      } catch (err) {
        alert("Erreur : " + err.message);
      }
    },

    async previewProof(req) {
      try {
        const { data, error } = await sbClient.storage
          .from("proofs")
          .createSignedUrl(req.proof_url, 60);

        if (error) throw error;
        window.open(data.signedUrl, "_blank");
      } catch (err) {
        alert("Impossible d'ouvrir le justificatif : " + err.message);
      }
    },

    toggleTheme() {
      this.darkMode = !this.darkMode;
      localStorage.setItem("theme", this.darkMode ? "dark" : "light");
      this.$nextTick(() => lucide.createIcons());
    },

    openAuthModal(tab) {
      this.authTab = tab;
      this.registerSubmitted = false;
      this.loginError = "";
      this.isAuthModalOpen = true;
      this.$nextTick(() => lucide.createIcons());
    },

    getStatusLabel(status) {
      switch (status) {
        case "pending":
          return "En attente";
        case "approved":
          return "Approuvé";
        case "rejected":
          return "Rejeté";
        default:
          return status;
      }
    },

    filteredResources() {
      let list = this.resources.filter((item) => {
        const query = this.searchQuery.toLowerCase();
        const matchQuery =
          this.searchQuery === "" ||
          item.title.toLowerCase().includes(query) ||
          (item.description &&
            item.description.toLowerCase().includes(query)) ||
          (item.tags && item.tags.some((t) => t.toLowerCase().includes(query)));

        const matchMatiere =
          this.selectedMatiere === "all" ||
          item.matiere === this.selectedMatiere;
        const matchType =
          this.selectedType === "Tous" || item.type === this.selectedType;
        const matchFiliere =
          this.selectedFiliere === "Tous" ||
          item.filiere === this.selectedFiliere ||
          item.filiere === "Tous";
        const matchStarred = !this.onlyStarred || item.isStarred;

        return (
          matchQuery &&
          matchMatiere &&
          matchType &&
          matchFiliere &&
          matchStarred
        );
      });

      if (this.sortBy === "stars") {
        list.sort((a, b) => b.stars - a.stars);
      } else if (this.sortBy === "downloads") {
        list.sort((a, b) => b.downloads - a.downloads);
      } else if (this.sortBy === "recent") {
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      return list;
    },

    countByMatiere(matiereId) {
      if (matiereId === "all") return this.resources.length;
      return this.resources.filter((r) => r.matiere === matiereId).length;
    },

    getMatiereLabel(id) {
      const mat = this.matieres.find((m) => m.id === id);
      return mat ? mat.label : id;
    },

    getTypeBadgeStyle(type) {
      switch (type) {
        case "Fiches":
          return "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300";
        case "DS / Concours":
          return "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300";
        case "Cours":
          return "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300";
        default:
          return "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300";
      }
    },
  }));
});
