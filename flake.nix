# This flake was initially generated by fh, the CLI for FlakeHub (version 0.1.21)
{
  # A helpful description of your flake
  description = "test";

  # Flake inputs
  inputs = {
    flake-schemas.url = "https://flakehub.com/f/DeterminateSystems/flake-schemas/*";

    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/*";
  };

  # Flake outputs that other flakes can use
  outputs = { self, flake-schemas, nixpkgs }:
    let
      # Helpers for producing system-specific outputs
      supportedSystems = [ "x86_64-linux" "aarch64-darwin" "x86_64-darwin" "aarch64-linux" ];
      forEachSupportedSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = import nixpkgs { inherit system; };
      });
    in {
      # Schemas tell Nix about the structure of your flake's outputs
      schemas = flake-schemas.schemas;

      # Development environments
      devShells = forEachSupportedSystem ({ pkgs }: {
        default = pkgs.mkShell {
          # Pinned packages available in the environment
          packages = with pkgs; [
            bun
            curl
            git
            jq
            wget
            nixpkgs-fmt
          ];

          # A hook run every time you enter the environment
          shellHook = ''
            echo "Using bun $(bun --version)"
          '';
        };
      });

      packages = forEachSupportedSystem ({ pkgs }: {
        default = pkgs.stdenv.mkDerivation {
          name = "chat-thyme";
          src = ./.;
          buildInputs = [ pkgs.bun ];
          buildPhase = ''
            bun install --no-progress --frozen-lockfile
            bun build src/index.ts --minify --sourcemap --bytecode --target=bun --outdir=dist
          '';

          installPhase = ''
            mkdir -p $out/lib
            cp dist/* $out/lib/
            mkdir -p $out/bin
            echo '#!/bin/sh' > $out/bin/app
            echo "exec ${pkgs.bun}/bin/bun run $out/lib/index.js" >> $out/bin/app
            chmod +x $out/bin/app
          '';
        };
      });
    };
}
