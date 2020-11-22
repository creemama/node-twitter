#!/bin/sh

script_dir="$(
	cd "$(dirname "${0}")"
	pwd -P
)"
cd "${script_dir}"
if [ ! -f shellutil/shellutil.sh ]; then
	git submodule update --init
fi
# shellcheck source=shellutil/shellutil.sh
. shellutil/shellutil.sh
# shellcheck source=shellutil/updateutil.sh
. shellutil/updateutil.sh
# set -o xtrace

apk_git=git~=2.24
apk_gnupg=gnupg~=2.2
apk_openssh=openssh~=8.1
node_image=creemama/node-no-yarn:14.15.1-alpine3.11

deploy() {
	# shellcheck disable=SC2039
	local current_version
	current_version="$(./cli.js --version)"
	# shellcheck disable=SC2039
	local major_version
	major_version="$(printf %s "${current_version}" | sed -E 's/([0-9]+)\.[0-9]+\.[0-9]+/\1/')"
	# shellcheck disable=SC2039
	local minor_version
	minor_version="$(printf %s "${current_version}" | sed -E 's/[0-9]+\.([0-9]+)\.[0-9]+/\1/')"
	# shellcheck disable=SC2039
	local patch_version
	patch_version="$(printf %s "${current_version}" | sed -E 's/[0-9]+\.[0-9]+\.([0-9]+)/\1/')"

	# shellcheck disable=SC2039
	local new_version
	# shellcheck disable=SC2039
	local commit_type
	while true; do
		printf %s 'Is this a [m]ajor, m[i]nor, or [p]atch fix? '
		read -r aip
		case "${aip}" in
		[Mm]*)
			new_version="$((major_version + 1)).0.0"
			commit_type=feat!
			break
			;;
		[Ii]*)
			new_version="${major_version}.$((minor_version + 1)).0"
			commit_type=feat
			break
			;;
		[Pp]*)
			new_version="${major_version}.${minor_version}.$((patch_version + 1))"
			commit_type=fix
			break
			;;
		*) echo 'Answer m for major, i for minor, or p for patch.' ;;
		esac
	done

	sed -E -i'' \
		"s/^  \"version\": \".*(\"[,]?)/  \"version\": \"${new_version}\\1/" \
		package.json
	sed -E -i'' \
		"s/^  \"version\": \".*(\"[,]?)/  \"version\": \"${new_version}\\1/" \
		package-lock.json

	export GPG_TTY
	GPG_TTY=/dev/console
	run_git commit -am "${commit_type}: bump node-twitter to v${new_version}"
	npm adduser
	npm publish --access public
	run_git push origin master
}

main() {
	# shellcheck disable=SC2039
	if [ "${1:-}" = deploy ]; then
		deploy "${script_dir}"
	elif [ "${1:-}" = docker ]; then
		shift
		run_docker "${@:-}"
	elif [ "${1:-}" = docker-deploy ]; then
		run_docker_deploy
	elif [ "${1:-}" = docker-format ]; then
		./shellutil/format.sh docker-format
	elif [ "${1:-}" = docker-pkg ]; then
		run_docker -c "./dev.sh pkg"
	elif [ "${1:-}" = docker-update ]; then
		run_docker_update
	elif [ "${1:-}" = format ]; then
		./shellutil/format.sh format
	elif [ "${1:-}" = git ]; then
		shift
		run_git "${@:-}"
	elif [ "${1:-}" = pkg ]; then
		run_pkg
	elif [ "${1:-}" = update ]; then
		update
	elif [ -n "${1:-}" ]; then
		printf '%s%s is not a recognized command.\n%s' "$(tred)" "${1}" "$(treset)"
		exit 1
	else
		printf '%sEnter a command.\n%s' "$(tred)" "$(treset)"
		exit 1
	fi
}

run_docker() {
	# shellcheck disable=SC2068
	docker run -it --rm \
		--volume "${script_dir}:/tmp" \
		--volume ~/.gnupg:/root/.gnupg \
		--volume ~/.node-twitter:/root/.node-twitter \
		--volume ~/.ssh:/root/.ssh \
		--workdir /tmp \
		"${node_image}" \
		sh ${@:-}
}

run_docker_deploy() {
	run_docker -c './dev.sh deploy'
	docker run --rm creemama/node-no-yarn:lts-alpine sh -c '
		npm install --global @util.js/node-twitter &&
		node-twitter'
}

run_docker_update() {
	docker pull creemama/node-no-yarn:lts-alpine
	docker run -it --rm \
		--volume "$(pwd):/tmp" \
		--workdir /tmp \
		creemama/node-no-yarn:lts-alpine \
		sh -c './dev.sh update'
}

# shellcheck disable=SC2068
run_git() {
	if ! test_command_exists git; then
		apk add "${apk_git}" "${apk_gnupg}" "${apk_openssh}"
	fi
	git ${@}
}

run_pkg() {
	npx pkg --out-path target --targets node14-alpine-x64,node14-linux-x64,node14-macos-x64,node14-win-x64 .
}

update() {
	# shellcheck disable=SC2119
	apk_update_node_image_version
	apk_update_package_version git
	apk_update_package_version gnupg
	apk_update_package_version openssh
	npx ncu -u
	run_git status
}

main "${@:-}"
