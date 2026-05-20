apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: bootstrap-my-plugin
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "2"
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: ${GIT_BASE_URL}/kuberse
    targetRevision: main
    path: plugins/my-plugin
    directory:
      recurse: false
      include: "{*/argocd-app.yaml}"
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
