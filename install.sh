#!/bin/bash

# ============================================
# AI Config Bootstrap Script
# Installs Claude Code agents, MCP servers,
# RAG infrastructure via Ansible
# ============================================

set -euo pipefail

# CHECKING ROOT
if [[ $EUID -eq 0 ]]; then
    echo "Please run this script not from superuser-do"
    exit 1
fi

# LOGO
printf "\n%.0s" {1..2}
echo "    _    ___    ____             __ _       "
echo "   / \  |_ _|  / ___|___  _ __  / _(_) __ _ "
echo "  / _ \  | |  | |   / _ \| '_ \| |_| |/ _\` |"
echo " / ___ \ | |  | |__| (_) | | | |  _| | (_| |"
echo "/_/   \_\___|  \____\___/|_| |_|_| |_|\__, |"
echo "                                       |___/ "
printf "\n%.0s" {1..2}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "darwin"
    elif [[ -f /etc/os-release ]]; then
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|linuxmint|pop)
                echo "debian"
                ;;
            fedora|rhel|centos|rocky|alma)
                echo "redhat"
                ;;
            arch|manjaro|endeavouros)
                echo "arch"
                ;;
            *)
                case "$ID_LIKE" in
                    *debian*|*ubuntu*)
                        echo "debian"
                        ;;
                    *rhel*|*fedora*)
                        echo "redhat"
                        ;;
                    *arch*)
                        echo "arch"
                        ;;
                    *)
                        echo "unknown"
                        ;;
                esac
                ;;
        esac
    else
        echo "unknown"
    fi
}

OS_TYPE=$(detect_os)
echo "Detected OS family: $OS_TYPE"

# Repository configuration
REPO_URL="https://github.com/ZeiZel/ai-config.git"
AI_CONFIG_DIR="${HOME}/.ai-config"

# Clone repository if not already present
if [ ! -f "all.yml" ]; then
    echo "Cloning ai-config repository..."

    # Check if git is installed
    if ! command -v git &> /dev/null; then
        echo "Installing git first..."
        case "$OS_TYPE" in
            darwin)
                if ! command -v brew &> /dev/null; then
                    echo "Installing Homebrew first..."
                    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

                    if [[ -f /opt/homebrew/bin/brew ]]; then
                        eval "$(/opt/homebrew/bin/brew shellenv)"
                    elif [[ -f /usr/local/bin/brew ]]; then
                        eval "$(/usr/local/bin/brew shellenv)"
                    fi
                fi
                brew install git
                ;;
            debian)
                sudo apt-get update
                sudo apt-get install -y git
                ;;
            redhat)
                sudo dnf install -y git
                ;;
            arch)
                sudo pacman -Sy --noconfirm git
                ;;
        esac
    fi

    # Clone repository
    if [ -d "$AI_CONFIG_DIR" ]; then
        echo "Directory $AI_CONFIG_DIR already exists, using it..."
        cd "$AI_CONFIG_DIR"
        git pull origin master || true
    else
        git clone "$REPO_URL" "$AI_CONFIG_DIR"
        cd "$AI_CONFIG_DIR"
    fi
else
    echo "Running from existing ai-config directory..."
fi

# Install Ansible based on OS
install_ansible() {
    case "$OS_TYPE" in
        darwin)
            echo "Installing Ansible via Homebrew..."
            if ! command -v brew &> /dev/null; then
                echo "Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

                if [[ -f /opt/homebrew/bin/brew ]]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [[ -f /usr/local/bin/brew ]]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
            fi
            brew install ansible
            ;;
        debian)
            echo "Installing Ansible via apt..."
            sudo apt-get update
            sudo apt-get install -y software-properties-common
            sudo apt-add-repository --yes --update ppa:ansible/ansible 2>/dev/null || true
            sudo apt-get install -y ansible
            ;;
        redhat)
            echo "Installing Ansible via dnf..."
            sudo dnf install -y epel-release 2>/dev/null || true
            sudo dnf install -y ansible
            ;;
        arch)
            echo "Installing Ansible via pacman..."
            sudo pacman -Sy --noconfirm ansible
            ;;
        *)
            echo "Unsupported OS. Please install Ansible manually."
            exit 1
            ;;
    esac
}

# Check if Ansible is already installed
if ! command -v ansible &> /dev/null; then
    install_ansible
else
    echo "Ansible is already installed: $(ansible --version | head -1)"
fi

# Get the directory where playbook is located
if [ -f "all.yml" ]; then
    SCRIPT_DIR="$(pwd)"
else
    SCRIPT_DIR="$AI_CONFIG_DIR"
fi

# Install Ansible collections if requirements.yml exists
if [ -f "$SCRIPT_DIR/requirements.yml" ]; then
    echo "Installing Ansible collections..."
    ansible-galaxy collection install -r "$SCRIPT_DIR/requirements.yml" 2>/dev/null || true
fi

# Run Ansible playbook
echo ""
echo "Running AI Config Ansible playbook..."
echo ""

cd "$SCRIPT_DIR"

if [[ "$OSTYPE" == "darwin"* ]]; then
    ansible-playbook -i inventory/hosts.ini all.yml -K "$@"
else
    ansible-playbook -i inventory/hosts.ini all.yml "$@"
fi

echo ""
echo "AI Config installation complete!"
echo "  Claude Code: ~/.local/bin/claude"
echo "  Config:      ~/.claude -> $SCRIPT_DIR/.claude"
echo ""
echo "Run 'setup-ai.sh' to enable RAG infrastructure (Qdrant + MCP servers)."
