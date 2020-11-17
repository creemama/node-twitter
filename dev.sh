#!/bin/sh

IFS=$(printf '\n\t')
set -o errexit -o nounset
if [ -n "${BASH_VERSION:-}" ]; then
	# shellcheck disable=SC2039
	set -o pipefail
fi
# set -o xtrace

node_image_version=14.15.1-alpine3.11
alpine_dependencies='
shellcheck~=0.7
shfmt@edgecommunity~=3.2
'

deploy() {
	# shellcheck disable=SC2039
	local current_version
	current_version="$(run_docker -c "./cli.js --version" | tr -d '\r')"
	# shellcheck disable=SC2039
	local major_version
	major_version="$(printf '%s' "$current_version" | sed -E 's/([0-9]+)\.[0-9]+\.[0-9]+/\1/')"
	# shellcheck disable=SC2039
	local minor_version
	minor_version="$(printf '%s' "$current_version" | sed -E 's/[0-9]+\.([0-9]+)\.[0-9]+/\1/')"
	# shellcheck disable=SC2039
	local patch_version
	patch_version="$(printf '%s' "$current_version" | sed -E 's/[0-9]+\.[0-9]+\.([0-9]+)/\1/')"

	# shellcheck disable=SC2039
	local new_version
	# shellcheck disable=SC2039
	local commit_type
	while true; do
		printf '%s' 'Is this a [m]ajor, m[i]nor, or [p]atch fix? '
		read -r aip
		case $aip in
		[Mm]*)
			new_version="$((major_version + 1)).0.0"
			commit_type="feat!"
			break
			;;
		[Ii]*)
			new_version="${major_version}.$((minor_version + 1)).0"
			commit_type="feat"
			break
			;;
		[Pp]*)
			new_version="${major_version}.${minor_version}.$((patch_version + 1))"
			commit_type="fix"
			break
			;;
		*) echo "Answer m for major, i for minor, or p for patch." ;;
		esac
	done

	# shellcheck disable=SC2039
	local script_dir
	script_dir="${1}"

	sed -E -i "" \
		"s/^^  \"version\": \".*(\"[,]?)/  \"version\": \"${new_version}\\1/" \
		"${script_dir}/package.json"
	sed -E -i "" \
		"s/^^  \"version\": \".*(\"[,]?)/  \"version\": \"${new_version}\\1/" \
		"${script_dir}/package-lock.json"

	export GPG_TTY
	GPG_TTY=$(tty)
	git commit -am "${commit_type}: bump node-twitter to v${new_version}"
	npm adduser
	npm publish --access public
}

format() {
	format_dev_sh
	run_prettier
}

format_dev_sh() {
	set -o xtrace
	printf '@edgecommunity http://nl.alpinelinux.org/alpine/edge/community\n' >>/etc/apk/repositories
	# shellcheck disable=SC2086
	apk --no-cache --update add ${alpine_dependencies}
	shfmt -w dev.sh
	shellcheck dev.sh
}

main() {
	# shellcheck disable=SC2039
	local script_dir
	script_dir="$(
		cd "$(dirname "${0}")"
		pwd -P
	)"
	cd "${script_dir}"
	if [ "${1:-}" = "deploy" ]; then
		deploy "${script_dir}"
	elif [ "${1:-}" = "docker" ]; then
		shift
		run_docker "${@:-}"
	elif [ "${1:-}" = "docker-format" ]; then
		run_docker -c "./dev.sh format"
	elif [ "${1:-}" = "docker-format-dev-sh" ]; then
		run_docker -c "./dev.sh format-dev-sh"
	elif [ "${1:-}" = "docker-pkg" ]; then
		run_docker -c "./dev.sh pkg"
	elif [ "${1:-}" = "docker-prettier" ]; then
		run_docker -c "./dev.sh prettier"
	elif [ "${1:-}" = "docker-update-deps" ]; then
		run_docker_update_deps "${script_dir}"
	elif [ "${1:-}" = "format" ]; then
		format
	elif [ "${1:-}" = "format-dev-sh" ]; then
		format_dev_sh
	elif [ "${1:-}" = "pkg" ]; then
		run_pkg
	elif [ "${1:-}" = "prettier" ]; then
		run_prettier
	else
		if [ -n "${1:-}" ]; then
			printf '\n"%s" is not a recognized command.\n' "${1}"
		fi
		printf '\nEnter a command:\n'
		printf '  deploy
  docker
  docker-format
  docker-format-dev-sh
  docker-pkg
  docker-prettier
  docker-update-deps
  format
  format-dev-sh
  pkg
  prettier

'
	fi
}

run_docker() {
	# shellcheck disable=SC2068
	docker run -it --rm \
		--volume "$(
			cd "$(dirname "${0}")"
			pwd -P
		):/tmp" \
		--volume ~/.node-twitter:/root/.node-twitter \
		--workdir /tmp \
		"creemama/node-no-yarn:${node_image_version}" \
		sh ${@:-}
}

run_docker_update_deps() {
	# shellcheck disable=SC2039
	local script_dir
	script_dir="${1}"

	docker pull creemama/node-no-yarn:lts-alpine
	run_docker_update_node_image_version "${script_dir}"
	run_docker_update_shellcheck_version "${script_dir}"
	run_docker_update_shfmt_version "${script_dir}"
	run_docker -c "npx ncu -u"
}

run_docker_update_node_image_version() {
	# shellcheck disable=SC2039
	local major_node_version
	major_node_version="$(
		docker run --rm \
			creemama/node-no-yarn:lts-alpine \
			node --version |
			tr -d 'v'
	)"

	# shellcheck disable=SC2039
	local alpine_version
	alpine_version="$(
		docker run --rm \
			creemama/node-no-yarn:lts-alpine \
			sh -c \
			"cat /etc/os-release \
    | grep VERSION_ID \
    | sed -E \"s/VERSION_ID=|(\.[0-9]+$)//g\""
	)"

	# shellcheck disable=SC2039
	local script_dir
	script_dir="${1}"

	sed -i "" \
		"s/^node_image_version=.*/node_image_version=${major_node_version}-alpine${alpine_version}/" \
		"${script_dir}/dev.sh"
}

run_docker_update_shellcheck_version() {
	# shellcheck disable=SC2039
	local shellcheck_version
	shellcheck_version="$(
		docker run -it --rm \
			creemama/node-no-yarn:lts-alpine \
			sh -c \
			"apk --no-cache --update search shellcheck |
    grep -E 'shellcheck-[0-9]' |
    head -n 1 |
    sed -E 's/shellcheck-([0-9]+\.[0-9]+)\..*/\1/'"
	)"

	# shellcheck disable=SC2039
	local script_dir
	script_dir="${1}"

	sed -i "" \
		"s/^shellcheck~=.*/shellcheck~=${shellcheck_version}/" \
		"${script_dir}/dev.sh"
	tr -d '\r' <"${script_dir}/dev.sh" >"${script_dir}/dev.sh.bak"
	rm "${script_dir}/dev.sh"
	mv "${script_dir}/dev.sh.bak" "${script_dir}/dev.sh"
	chmod +x "${script_dir}/dev.sh"
}

run_docker_update_shfmt_version() {
	# shellcheck disable=SC2039
	local shfmt_version
	shfmt_version="$(
		docker run -it --rm \
			creemama/node-no-yarn:lts-alpine \
			sh -c \
			"printf '%s' '@edgecommunity http://nl.alpinelinux.org/alpine/edge/community' >> /etc/apk/repositories \
    && apk --no-cache --update search shfmt |
    grep -E 'shfmt-[0-9]' |
    head -n 1 |
    sed -E 's/shfmt-([0-9]+\.[0-9]+)\..*/\1/'"
	)"

	# shellcheck disable=SC2039
	local script_dir
	script_dir="${1}"

	sed -i "" \
		"s/^shfmt@edgecommunity~=.*/shfmt@edgecommunity~=${shfmt_version}/" \
		"${script_dir}/dev.sh"
	tr -d '\r' <"${script_dir}/dev.sh" >"${script_dir}/dev.sh.bak"
	rm "${script_dir}/dev.sh"
	mv "${script_dir}/dev.sh.bak" "${script_dir}/dev.sh"
	chmod +x "${script_dir}/dev.sh"
}

run_pkg() {
	npx pkg --out-path target --targets node14-alpine-x64,node14-linux-x64,node14-macos-x64,node14-win-x64 .
}

run_prettier() {
	npx prettier --write .
}

main "${@:-}"
