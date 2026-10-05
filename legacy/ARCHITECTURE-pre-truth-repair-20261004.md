# colossus-gateway Architecture

## Core Domains

1. **Tensor Parallel Fabric:** Uses NCCL and custom ring-reduce algorithms.
2. **Attention Routing:** Mixture-of-Experts (MoE) dispatch with dynamic load balancing.
3. **Thermal Manager:** Real-time throttling predictive models for supercluster nodes.
